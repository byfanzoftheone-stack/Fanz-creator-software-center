// License webhook tests. Temp SQLite store; NO Postgres needed. Run: node --test test/license.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { execFileSync } = require('child_process');
const lic = require('../license');
const billing = require('../billing');

const SECRET = 'whsec_test_placeholder';
const sign = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex')}`;
const evt = (id, price = 'price_creator_t', extra = {}) => JSON.stringify({ id, type: 'checkout.session.completed',
  data: { object: { id: 'cs_' + id, payment_status: 'paid', metadata: { price_id: price }, customer: 'cus_1', subscription: 'sub_' + id, customer_details: { email: 'fan@example.com' }, ...extra } } });

let dir, env, server, base;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-'));
  env = { STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_CREATOR: 'price_creator_t', STRIPE_PRICE_STUDIO: 'price_studio_t', LICENSE_DB: path.join(dir, 'l.sqlite') };
  const app = express();
  app.post('/api/stripe/webhook', express.raw({ type: '*/*' }), lic.webhookHandler(env));
  app.use(express.json());
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/stripe/webhook`;
});
test.after(async () => { server.close(); const { store } = await lic.getLicense(env); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (body, sig) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'stripe-signature': sig } : {}) }, body });
const pending = async () => { const { lw } = await lic.getLicense(env); return lw.pendingDeliveries(); };

test('bad or missing signature is rejected, nothing issued', async () => {
  const b = evt('evt_bad');
  assert.strictEqual((await post(b)).status, 400);
  assert.strictEqual((await post(b, sign(b, undefined, 'whsec_wrong'))).status, 400);
  assert.strictEqual((await post(b, sign(b, 1000))).status, 400);   // stale timestamp
  assert.strictEqual((await pending()).length, 0);
});

test('valid signature + paid known price issues one key with the mapped tier; key validates', async () => {
  const b = evt('evt_1');
  const r = await post(b, sign(b));
  assert.strictEqual(r.status, 200);
  const p = await pending();
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].tier, 'creator');
  assert.match(p[0].key, /^FZ-CREATOR-/);
  assert.deepStrictEqual(await lic.validateKey(p[0].key, env), { valid: true, tier: 'creator' });
  assert.strictEqual((await lic.validateKey('FZ-CREATOR-forged', env)).valid, false);
});

test('replay of the same event issues nothing more', async () => {
  const b = evt('evt_1');
  const r = await post(b, sign(b));
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).duplicate, true);
  assert.strictEqual((await pending()).length, 1);
});

test('25 concurrent copies of one event => exactly one key', async () => {
  const b = evt('evt_conc', 'price_studio_t');
  const rs = await Promise.all(Array.from({ length: 25 }, () => post(b, sign(b))));
  assert.ok(rs.every(r => r.status === 200));
  const studio = (await pending()).filter(x => x.tier === 'studio');
  assert.strictEqual(studio.length, 1);
});

test('unknown price (and client-chosen metadata) issues nothing', async () => {
  const before = (await pending()).length;
  const b = evt('evt_unknown', 'price_attacker_chosen');
  assert.strictEqual((await post(b, sign(b))).status, 200);
  assert.strictEqual((await pending()).length, before);
});

test('unpaid session issues nothing', async () => {
  const before = (await pending()).length;
  const b = evt('evt_unpaid', 'price_creator_t', { payment_status: 'unpaid' });
  await post(b, sign(b));
  assert.strictEqual((await pending()).length, before);
});

test('plan resolution: valid key maps to tier; invalid key and no key keep OWNER_PLAN', async () => {
  const key = (await pending()).find(x => x.tier === 'studio').key;
  const v = k => lic.validateKey(k, env);
  const req = k => ({ get: h => (h === 'x-license-key' ? k : undefined) });
  assert.strictEqual((await billing.resolvePlan(req(key), v)).id, 'studio');
  assert.strictEqual((await billing.resolvePlan(req('FZ-STUDIO-nope'), v)).id, billing.currentPlan().id);
  assert.strictEqual((await billing.resolvePlan(req(undefined), v)).id, billing.currentPlan().id);
});

test('delivery CLI: pending hides keys, deliver needs --approver and drops plaintext', async () => {
  const cli = (...a) => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'licenses.js'), ...a], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const out = cli('pending');
  assert.ok(!/FZ-/.test(out));
  const hash = out.split('\n')[0].split('\t')[0];
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'licenses.js'), 'deliver', hash], { env: { ...process.env, ...env }, stdio: 'pipe' }));
  cli('deliver', hash, '--approver', 'Test Owner');
  assert.ok(!(await pending()).some(x => x.hash === hash));
});

test('FAIL CLOSED: unconfigured store => webhook 503 and key gate denies', async () => {
  const bare = { STRIPE_WEBHOOK_SECRET: SECRET };   // no LICENSE_DATABASE_URL / LICENSE_DB
  const app = express();
  app.post('/w', express.raw({ type: '*/*' }), lic.webhookHandler(bare));
  const s = await new Promise(r => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const saved = { ...process.env };
  try {
    delete process.env.LICENSE_DB; delete process.env.LICENSE_DATABASE_URL;
    lic.resetLicenseCache();
    const b = evt('evt_x');
    const r = await fetch(`http://127.0.0.1:${s.address().port}/w`, { method: 'POST', headers: { 'stripe-signature': sign(b) }, body: b });
    assert.strictEqual(r.status, 503);
    assert.deepStrictEqual(await lic.validateKey('FZ-STUDIO-anything', bare), { valid: false });
    const plan = await billing.resolvePlan({ get: () => 'FZ-STUDIO-anything' }, k => lic.validateKey(k, bare));
    assert.strictEqual(plan.id, billing.currentPlan().id);
  } finally { s.close(); Object.assign(process.env, saved); lic.resetLicenseCache(); }
});

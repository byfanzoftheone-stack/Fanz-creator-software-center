// license-webhook: verified Stripe webhook -> license key issuance.
// Zero dependencies. Never sends email or calls Stripe; it only verifies,
// records, and queues keys for a human-approved delivery step.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOLERANCE_SECONDS = 300;

/** Verify a Stripe-Signature header against the RAW request body. */
export function verifyStripeSignature(rawBody, header, secret, { now = Date.now(), tolerance = TOLERANCE_SECONDS } = {}) {
  if (!secret) return { ok: false, reason: 'no_secret_configured' };
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) return { ok: false, reason: 'body_must_be_raw' };
  if (!header) return { ok: false, reason: 'missing_header' };
  const parts = Object.create(null);
  const v1 = [];
  for (const kv of String(header).split(',')) {
    const i = kv.indexOf('=');
    if (i < 1) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    if (k === 'v1') v1.push(v); else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || v1.length === 0) return { ok: false, reason: 'malformed_header' };
  if (Math.abs(now / 1000 - t) > tolerance) return { ok: false, reason: 'timestamp_outside_tolerance' };
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  for (const sig of v1) {
    if (!/^[0-9a-f]{64}$/i.test(sig)) continue;
    const got = Buffer.from(sig, 'hex');
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

export function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

export function generateKey(tier) {
  const rand = crypto.randomBytes(18).toString('base64url');
  return `FZ-${String(tier).toUpperCase()}-${rand}`;
}

/** Atomic JSON file store (single process). */
export class JsonStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { events: {}, licenses: {}, outbox: {} }; throw e; }
  }
  write(data) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

function maskEmail(e) {
  if (!e || !e.includes('@')) return null;
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}***@${d}`;
}

/**
 * createLicenseWebhook({ secret, priceTiers, store, audit })
 *  - priceTiers: { price_xxx: 'pro', ... }  (unknown prices are ignored, never guessed)
 *  - store: JsonStore (or compatible read()/write())
 *  - audit: optional (record) => void
 * handle(rawBody, signatureHeader) -> { status, body }
 */
export function createLicenseWebhook({ secret, priceTiers = {}, store, audit = () => {}, now = () => Date.now() }) {
  if (!store) throw new Error('store required');

  function handle(rawBody, signatureHeader) {
    const v = verifyStripeSignature(rawBody, signatureHeader, secret, { now: now() });
    if (!v.ok) {
      audit({ type: 'webhook_rejected', reason: v.reason });
      return { status: 400, body: { error: v.reason } };
    }
    let event;
    try { event = JSON.parse(rawBody.toString()); } catch { return { status: 400, body: { error: 'invalid_json' } }; }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return { status: 400, body: { error: 'invalid_event' } };

    const db = store.read();
    if (db.events[event.id]) return { status: 200, body: { received: true, duplicate: true } };

    let result = { handled: false };
    const obj = event.data && event.data.object ? event.data.object : {};

    if (event.type === 'checkout.session.completed') {
      const paid = obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required';
      // Tier comes ONLY from our server-side price->tier map, never from client metadata.
      const priceId = obj.metadata && obj.metadata.price_id ? obj.metadata.price_id : (obj.price_id || null);
      const tier = priceId ? priceTiers[priceId] : undefined;
      if (!paid) result = { handled: false, reason: 'not_paid' };
      else if (!tier) result = { handled: false, reason: 'unknown_price' };
      else {
        const key = generateKey(tier);
        const h = hashKey(key);
        db.licenses[h] = {
          tier, status: 'active', created: new Date(now()).toISOString(),
          customer: obj.customer || null, subscription: obj.subscription || null,
          email_masked: maskEmail(obj.customer_details && obj.customer_details.email),
          session: obj.id || null,
        };
        // Plaintext key exists only here until a human marks it delivered.
        db.outbox[h] = {
          key, tier, email: (obj.customer_details && obj.customer_details.email) || null,
          status: 'pending_delivery', created: new Date(now()).toISOString(),
        };
        result = { handled: true, action: 'issued', tier, hash: h };
      }
    } else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed' || event.type === 'charge.refunded') {
      const ref = obj.subscription || obj.id || null;
      let n = 0;
      for (const [h, lic] of Object.entries(db.licenses)) {
        const match = (lic.subscription && lic.subscription === ref) || (obj.customer && lic.customer === obj.customer);
        if (match && lic.status === 'active') { lic.status = 'revoked'; lic.revoked = new Date(now()).toISOString(); lic.reason = event.type; n++; }
      }
      result = { handled: n > 0, action: 'revoked', count: n };
    }

    db.events[event.id] = { type: event.type, at: new Date(now()).toISOString() };
    store.write(db);
    audit({ type: 'webhook_processed', event: event.id, event_type: event.type, result: { handled: result.handled, action: result.action, reason: result.reason, tier: result.tier } });
    return { status: 200, body: { received: true, handled: result.handled } };
  }

  /** Validate a customer-presented key. Constant-time on the hash. */
  function validate(key) {
    if (!key || typeof key !== 'string') return { valid: false };
    const lic = store.read().licenses[hashKey(key)];
    if (!lic || lic.status !== 'active') return { valid: false };
    return { valid: true, tier: lic.tier };
  }

  /** Owner action: list keys awaiting human-approved delivery. Plaintext is returned; protect the output. */
  function pendingDeliveries() {
    const db = store.read();
    return Object.entries(db.outbox).filter(([, o]) => o.status === 'pending_delivery').map(([hash, o]) => ({ hash, tier: o.tier, email: o.email, key: o.key }));
  }

  /** Owner action: after delivering a key by hand, drop the plaintext. */
  function markDelivered(hash, approver) {
    if (!approver || typeof approver !== 'string') throw new Error('approver required');
    const db = store.read();
    const o = db.outbox[hash];
    if (!o) throw new Error('unknown outbox entry');
    db.outbox[hash] = { tier: o.tier, status: 'delivered', delivered_at: new Date(now()).toISOString(), approver };
    store.write(db);
    audit({ type: 'key_delivered', hash, approver });
    return true;
  }

  return { handle, validate, pendingDeliveries, markDelivered };
}

#!/usr/bin/env node
// Owner CLI for license delivery. Human-run only. It NEVER sends email and NEVER calls Stripe:
// you send the key yourself, then record it here with --approver.
//   node scripts/licenses.js pending [--show-keys]
//   node scripts/licenses.js deliver <hash> --approver "Your Name"
//   node scripts/licenses.js migrate-json <file>
// Uses the same store env as the server (LICENSE_DATABASE_URL or LICENSE_DB).
const { esm } = require('../license');

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i < 0 ? null : (args[i + 1] ?? true); };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--approver'));

(async () => {
  const [cmd, arg] = pos;
  if (!['pending', 'deliver', 'migrate-json'].includes(cmd)) {
    console.error('usage: licenses.js pending [--show-keys] | deliver <hash> --approver NAME | migrate-json <file>');
    process.exit(2);
  }
  const { createAsyncLicenseWebhook, storeFromEnv, migrateFromLegacyJson } = await esm('async.mjs');
  let store;
  try { store = await storeFromEnv(process.env); } catch (e) { console.error('license store not configured:', e.message); process.exit(1); }
  try {
    if (cmd === 'migrate-json') {
      if (!arg) { console.error('migrate-json needs a file'); process.exit(2); }
      console.log(JSON.stringify(await migrateFromLegacyJson(arg, store)));
    } else {
      const lw = createAsyncLicenseWebhook({ secret: process.env.STRIPE_WEBHOOK_SECRET || 'cli-unused', store });
      if (cmd === 'pending') {
        const rows = await lw.pendingDeliveries();
        const show = flag('--show-keys') === true;
        if (!rows.length) console.log('No pending deliveries.');
        for (const r of rows) console.log(`${r.hash}\t${r.tier}\t${r.email || '-'}${show ? '\t' + r.key : ''}`);
        if (rows.length && !show) console.log('(keys hidden; add --show-keys to reveal, then send them yourself)');
      } else {
        const approver = flag('--approver');
        if (!arg || typeof approver !== 'string') { console.error('deliver needs <hash> and --approver NAME'); process.exit(2); }
        await lw.markDelivered(arg, approver);
        console.log(`Marked delivered by ${approver}; plaintext key dropped.`);
      }
    }
  } catch (e) { console.error('failed:', e.message); process.exitCode = 1; }
  finally { if (store.close) store.close(); if (store.pool?.end) await store.pool.end().catch(() => {}); }
})();

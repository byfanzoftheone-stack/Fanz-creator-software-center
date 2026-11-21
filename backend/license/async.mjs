// Async license webhook over a pluggable transactional store (see stores.mjs).
// Same behavior and responses as index.mjs createLicenseWebhook, but safe under concurrency and multi-instance
// deploys: the event claim, the key issue and the outbox write commit together or not at all.
// It never sends email and never calls Stripe.
import fs from 'node:fs';
import { verifyStripeSignature, hashKey, generateKey } from './index.mjs';

export { MemoryStore, JsonFileStore, SqliteStore, PostgresStore, POSTGRES_SCHEMA, storeFromEnv } from './stores.mjs';

const maskEmail = (e) => (e && e.includes('@') ? `${e.split('@')[0].slice(0, 1)}***@${e.split('@')[1]}` : null);

export function createAsyncLicenseWebhook({ secret, priceTiers = {}, store, audit = () => {}, now = () => Date.now() }) {
  if (!store || typeof store.transaction !== 'function') throw new Error('store with transaction() required');
  const iso = () => new Date(now()).toISOString();

  async function handle(rawBody, signatureHeader) {
    const v = verifyStripeSignature(rawBody, signatureHeader, secret, { now: now() });
    if (!v.ok) { await audit({ type: 'webhook_rejected', reason: v.reason }); return { status: 400, body: { error: v.reason } }; }
    let event;
    try { event = JSON.parse(rawBody.toString()); } catch { return { status: 400, body: { error: 'invalid_json' } }; }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return { status: 400, body: { error: 'invalid_event' } };

    const obj = (event.data && event.data.object) || {};
    const out = await store.transaction(async (tx) => {
      // Claim first: if anything below throws, the whole transaction rolls back and Stripe's retry will succeed.
      if (!(await tx.claimEvent(event.id, event.type, iso()))) return { duplicate: true };
      let result = { handled: false };
      if (event.type === 'checkout.session.completed') {
        const paid = obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required';
        const priceId = (obj.metadata && obj.metadata.price_id) || obj.price_id || null;
        const tier = priceId ? priceTiers[priceId] : undefined;  // tier ONLY from the server-side map
        if (!paid) result = { handled: false, reason: 'not_paid' };
        else if (!tier) result = { handled: false, reason: 'unknown_price' };
        else {
          const key = generateKey(tier);
          const h = hashKey(key);
          const email = (obj.customer_details && obj.customer_details.email) || null;
          await tx.putLicense(h, { tier, status: 'active', created: iso(), customer: obj.customer || null, subscription: obj.subscription || null, email_masked: maskEmail(email), session: obj.id || null });
          await tx.putOutbox(h, { key, tier, email, status: 'pending_delivery', created: iso() });
          result = { handled: true, action: 'issued', tier, hash: h };
        }
      } else if (['customer.subscription.deleted', 'invoice.payment_failed', 'charge.refunded'].includes(event.type)) {
        const n = await tx.revokeMatching({ subscription: obj.subscription || obj.id || null, customer: obj.customer || null, reason: event.type, at: iso() });
        result = { handled: n > 0, action: 'revoked', count: n };
      }
      return { duplicate: false, result };
    });
    if (out.duplicate) return { status: 200, body: { received: true, duplicate: true } };
    const r = out.result;
    await audit({ type: 'webhook_processed', event: event.id, event_type: event.type, result: { handled: r.handled, action: r.action, reason: r.reason, tier: r.tier } });
    return { status: 200, body: { received: true, handled: r.handled } };
  }

  async function validate(key) {
    if (!key || typeof key !== 'string') return { valid: false };
    const l = await store.transaction((tx) => tx.getLicense(hashKey(key)));
    return l && l.status === 'active' ? { valid: true, tier: l.tier } : { valid: false };
  }
  const pendingDeliveries = () => store.transaction((tx) => tx.listPending());
  async function markDelivered(hash, approver) {
    if (!approver || typeof approver !== 'string') throw new Error('approver required');
    await store.transaction((tx) => tx.markDelivered(hash, approver, iso()));
    await audit({ type: 'key_delivered', hash, approver });
    return true;
  }
  return { handle, validate, pendingDeliveries, markDelivered };
}

/** Import a legacy JSON DB (from index.mjs JsonStore) into any store. Idempotent: existing rows are overwritten, events not re-claimed. */
export async function migrateFromLegacyJson(file, store) {
  let db;
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { licenses: 0, outbox: 0, events: 0 }; throw e; }
  const c = { licenses: 0, outbox: 0, events: 0 };
  await store.transaction(async (tx) => {
    for (const [id, e] of Object.entries(db.events || {})) { await tx.claimEvent(id, e.type || 'unknown', e.at || new Date().toISOString()); c.events++; }
    for (const [h, l] of Object.entries(db.licenses || {})) { await tx.putLicense(h, l); c.licenses++; }
    for (const [h, o] of Object.entries(db.outbox || {})) { await tx.putOutbox(h, o); c.outbox++; }
  });
  return c;
}

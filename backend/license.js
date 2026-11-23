// CommonJS bridge to the vendored ASYNC license module (ESM). Fail closed: no configured store => 503 / deny.
// Verifies, records and queues only. Never sends email, never calls Stripe.
const path = require('path');
const { pathToFileURL } = require('url');

const esm = file => import(pathToFileURL(path.join(__dirname, 'license', file)).href);

// Price id (server-side env) -> tier (= plan id). Free has no price. Client metadata can never choose a tier.
const priceTiers = (env = process.env) => {
  const m = {};
  if (env.STRIPE_PRICE_CREATOR) m[env.STRIPE_PRICE_CREATOR] = 'creator';
  if (env.STRIPE_PRICE_STUDIO) m[env.STRIPE_PRICE_STUDIO] = 'studio';
  return m;
};

// Module-level cache of the pending/ready license service. A failed init is NOT cached (retried next call).
let cached = null;
function getLicense(env = process.env) {
  if (!cached) {
    cached = (async () => {
      if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET not set');
      const { createAsyncLicenseWebhook, storeFromEnv } = await esm('async.mjs');
      const store = await storeFromEnv(env);
      const lw = createAsyncLicenseWebhook({
        secret: env.STRIPE_WEBHOOK_SECRET,
        priceTiers: priceTiers(env),
        store,
        audit: r => console.log(JSON.stringify({ ts: new Date().toISOString(), src: 'license', ...r })),
      });
      return { lw, store };
    })();
    cached.catch(() => { cached = null; });
  }
  return cached;
}
const resetLicenseCache = () => { cached = null; };

// Express handler: mount with express.raw({ type: '*/*' }) on THIS route only, before any json parser.
const webhookHandler = (env = process.env) => async (req, res) => {
  let svc;
  try { svc = await getLicense(env); }
  catch { return res.status(503).json({ error: 'license_store_not_configured' }); }
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'body_must_be_raw' });
  try {
    const out = await svc.lw.handle(req.body, req.get('stripe-signature'));
    res.status(out.status).json(out.body);
  } catch (e) {
    console.error('license webhook failed:', e.message);
    res.status(500).json({ error: 'internal' });   // Stripe will retry; the transaction rolled back
  }
};

// Returns { valid, tier } and NEVER throws: any failure or missing config denies.
async function validateKey(key, env = process.env) {
  if (!key || typeof key !== 'string') return { valid: false };
  try { const { lw } = await getLicense(env); const v = await lw.validate(key); return v.valid ? { valid: true, tier: v.tier } : { valid: false }; }
  catch { return { valid: false }; }
}

module.exports = { priceTiers, getLicense, resetLicenseCache, webhookHandler, validateKey, esm };

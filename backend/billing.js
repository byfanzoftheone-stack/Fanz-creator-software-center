// Plans, quotas and checkout stub. No secrets here: Stripe keys come from env only.
// Going live with real payments is a human decision: CHECKOUT_ENABLED must be "true".

const PLANS = {
  free:    { id: 'free',    name: 'Free',    price_usd_month: 0,  voices: 1,  monthly_chars: 2000,   stripe_price_env: null },
  creator: { id: 'creator', name: 'Creator', price_usd_month: 19, voices: 3,  monthly_chars: 50000,  stripe_price_env: 'STRIPE_PRICE_CREATOR' },
  studio:  { id: 'studio',  name: 'Studio',  price_usd_month: 79, voices: 15, monthly_chars: 300000, stripe_price_env: 'STRIPE_PRICE_STUDIO' },
};

// The owner's current plan (single-owner v1). Unknown values fall back to free.
const currentPlan = () => PLANS[String(process.env.OWNER_PLAN || 'free').toLowerCase()] || PLANS.free;
// Async plan resolution: a valid X-License-Key (module-validated) maps to its tier; otherwise OWNER_PLAN as before.
// Fail closed: unconfigured/unreachable store or unknown tier never yields a paid plan from the key.
async function resolvePlan(req, validate = require('./license').validateKey) {
  const key = req && req.get && req.get('x-license-key');
  if (key) {
    const v = await validate(key);
    if (v.valid && PLANS[v.tier] && PLANS[v.tier].stripe_price_env) return PLANS[v.tier];
  }
  return currentPlan();
}
const publicPlans = () => Object.values(PLANS).map(({ stripe_price_env, ...p }) => p);

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const isEmail = s => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);

// Simple in-memory per-IP limiter for public endpoints.
function limiter(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const h = (hits.get(req.ip) || []).filter(t => now - t < windowMs);
    if (h.length >= max) return res.status(429).json({ reason: 'Too many requests. Try again later.' });
    h.push(now); hits.set(req.ip, h);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

// Returns { mode: 'stub' | 'stripe', url?, message }.
async function createCheckout(planId, { successUrl, cancelUrl }) {
  const plan = PLANS[planId];
  if (!plan || !plan.stripe_price_env) return { error: 'Unknown or free plan.' };
  const key = process.env.STRIPE_SECRET_KEY;
  const price = process.env[plan.stripe_price_env];
  if (process.env.CHECKOUT_ENABLED !== 'true' || !key || !price)
    return { mode: 'stub', message: 'Checkout is not live yet. Your interest was noted; join the waitlist and the owner will contact you after launch approval.' };
  const body = new URLSearchParams({ mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', success_url: successUrl, cancel_url: cancelUrl, 'metadata[price_id]': price });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) return { error: 'Payment provider refused the request.' };
  return { mode: 'stripe', url: j.url };
}

module.exports = { PLANS, currentPlan, resolvePlan, publicPlans, isEmail, limiter, createCheckout };

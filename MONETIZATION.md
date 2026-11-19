# Monetization

## What it is
Creator Center is a local-first creator software PWA with a **consent-first AI voice clone** (voice owner records a live consent statement, owner approves, every action audit-logged). The trust story is the product: creators and small studios can use an AI voice without legal or ethical risk.

## Who pays
- Solo creators (YouTube/podcast/TikTok) who want a consistent narration voice.
- Small studios/agencies producing voiceovers for clients who need provable consent records.
- Coaches/course sellers scaling spoken content.

## Pricing (defined in `backend/billing.js`, shown at `GET /api/plans`)
| Tier | Price | Voices | Speech/month |
|---|---|---|---|
| Free | $0 | 1 | 2,000 chars |
| Creator | $19/mo | 3 | 50,000 chars |
| Studio | $79/mo | 15 | 300,000 chars |

Check margins against your ElevenLabs plan cost per character before launch; adjust the numbers in `billing.js`.

## Revenue paths
1. Subscriptions (Creator, Studio) via Stripe Checkout.
2. Done-for-you voice setup (one-time $99-$249) sold manually to studios.
3. Consent-audit export as a compliance add-on for agencies (+$29/mo, not built).
4. Annual plans (2 months free) once monthly retention is proven.

## What is built
Waitlist capture (`POST /api/waitlist`), pricing API, checkout stub that calls Stripe only when `CHECKOUT_ENABLED=true` plus Stripe env vars are set, and per-plan monthly quota enforced on `speak` (rule BL-1, HTTP 402).

## Launch checklist
- [ ] Set Railway vars (see `backend/.env.example`); real keys only in the dashboard.
- [ ] Confirm ElevenLabs plan permits commercial use and instant cloning; compute cost per 1k chars.
- [ ] Create Stripe products/prices; put price IDs in env; test with `sk_test_` keys first.
- [ ] Add a Stripe webhook (with signature verification) to flip a customer's plan. Not built yet: today `OWNER_PLAN` is a single-owner flag.
- [ ] Multi-user accounts (plan is single-owner today). Required before selling to more than one customer.
- [ ] Terms of service, privacy policy, refund policy; consent/misuse clause.
- [ ] Wire a waitlist form and pricing section into `frontend/` (API is ready).
- [ ] Review `LAUNCH.md` copy; post manually after approval.

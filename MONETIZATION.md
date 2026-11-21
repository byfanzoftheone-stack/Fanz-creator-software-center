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
- [x] Stripe webhook built: `POST /api/stripe/webhook` (raw body, HMAC signature verified, idempotent, transactional) issues a license key `FZ-<PLAN>-...` on a paid checkout. Tier comes only from the server-side price map (`STRIPE_PRICE_CREATOR`/`STUDIO`); the checkout stub sets `metadata.price_id`. Unknown prices issue nothing. Not tested against live Stripe.
- [ ] Set `STRIPE_WEBHOOK_SECRET` and `LICENSE_DATABASE_URL` (same Postgres as `DATABASE_URL`); point the Stripe endpoint at `/api/stripe/webhook` (events: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`, `charge.refunded`).
- [ ] Deliver keys by hand (nothing is emailed): `node backend/scripts/licenses.js pending --show-keys`, send the key yourself, then `deliver <hash> --approver "Name"` (drops the plaintext). `migrate-json <file>` imports a legacy JSON DB.

**Using a key:** send `X-License-Key` on `speak`; a valid key resolves that plan and BL-1 applies by it. No/invalid key falls back to `OWNER_PLAN`. If the license store is not configured the webhook answers 503 and keys are denied (fail closed).
Limits: the monthly quota counter is still global (single-owner), not per key; the plaintext key sits in `license_outbox` until delivered, so protect the database; the license tables live beside the app tables.
- [ ] Multi-user accounts (plan is single-owner today). Required before selling to more than one customer.
- [ ] Terms of service, privacy policy, refund policy; consent/misuse clause.
- [ ] Wire a waitlist form and pricing section into `frontend/` (API is ready).
- [ ] Review `LAUNCH.md` copy; post manually after approval.

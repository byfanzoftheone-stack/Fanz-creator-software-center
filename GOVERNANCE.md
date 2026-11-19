# Governance

Principle: deny > require_approval > allow. A human decides anything that spends money, publishes, or contacts people.

| Control | Where | Status |
|---|---|---|
| Human approval before a voice is created | `policy.js` VC-4, `/api/voices/:id/approve` | Enforced |
| Consent gate (adult, non-public-figure, live statement) | `policy.js` VC-1..3 | Enforced |
| Append-only audit log (DB trigger blocks UPDATE/DELETE) | `db.js`, VC-8 | Enforced, tested |
| Spend control: per-plan monthly speech quota | `billing.js`, rule BL-1 | Enforced |
| Payments off by default: needs `CHECKOUT_ENABLED=true` + Stripe env | `billing.js` | Enforced |
| Outbound messages: none sent. Waitlist stores emails; owner contacts manually | `server.js` | By design |
| Publishing/posting: not automated; `LAUNCH.md` is copy for manual posting | - | By design |
| No secrets in code: env only; `.env*` gitignored (examples allowed) | `.gitignore`, `.env.example` | Enforced |
| Rate limits: login lockout (5 tries/15 min), public endpoints 10/hour/IP | `server.js`, `billing.js` | Enforced (in-memory; use a shared store if scaled to many instances) |
| Audit stores hashes (email, spoken text), not raw content | `server.js` | Enforced |

## Rules for operators and agents
1. Never commit keys; rotate any key that appears in chat or git history.
2. Do not enable `CHECKOUT_ENABLED` until Stripe test-mode flow, terms and refund policy are reviewed.
3. Do not send outbound email/DMs or post publicly without a named human approving the exact text.
4. Review `/api/audit` weekly; investigate `deny` spikes and `login.failed`.
5. Honest limits: see `PLAN.md` (single owner, no watermark, consent cannot prove speaker identity).

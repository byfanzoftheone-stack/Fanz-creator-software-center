# Creator Center

Local-first creator software center (PWA) with a **consent-first voice clone**.

- `frontend/` — static app (Vercel, no build step). Backend address lives in `frontend/config.js`.
- `backend/` — Node/Express + PostgreSQL (Railway: Root Directory `backend`, Build `npm install`, Start `node server.js`).
- `PLAN.md` — why and how the consent gate works, the VC-1…VC-8 rules, and honest limits.

## Railway variables

| Name | Set by |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (already set) |
| `PORT` | `8080` (already set) |
| `ALLOWED_ORIGIN` | the Vercel URL of the front end |
| `OWNER_PASSCODE` | **Travis, in the Railway dashboard** |
| `ELEVENLABS_API_KEY` | **Travis, in the Railway dashboard** (paid ElevenLabs plan needed for cloning) |

Secrets never go in this repo or in chat.

## Tests

```
cd backend && npm install && DATABASE_URL=postgres://... npm test
```

Runs 29 end-to-end checks against a fake ElevenLabs (no credits used).

## Updating the front end

Bump `VERSION` in `frontend/sw.js` on every deploy so installed copies pick up changes.

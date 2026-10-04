# Creator Center — Consent-First Voice Clone (v1 plan)

**Why this exists:** cloning a voice is the part of Creator Center that can hurt someone — a copied voice can be used to trick family, banks, or the public. So the clone is built *consent first*: no voice is ever created unless the person whose voice it is said, out loud and on record, that they agree — and Travis approved it as a second step. Every action lands in an append-only audit log.

**Scope (v1):** private, single owner (Travis). Locked by an owner passcode. Accounts for other users come later and will need per-user ownership of voices.

## Architecture

```
frontend/  (static PWA, Vercel)  ──HTTPS──▶  backend/ (Node/Express, Railway)  ──▶  ElevenLabs API
                                                     │
                                                     └──▶  PostgreSQL (Railway)
```

- The ElevenLabs key lives **only** in Railway variables. The browser never sees it.
- Railway settings: Root Directory `backend`, Build `npm install`, Start `node server.js`.

| Railway variable | What it is |
|---|---|
| `DATABASE_URL` | Railway Postgres (linked automatically) |
| `OWNER_PASSCODE` | Travis's passcode for logging in (set by Travis, never in chat) |
| `ELEVENLABS_API_KEY` | ElevenLabs key (set by Travis, never in chat). Instant cloning needs a paid ElevenLabs plan. |
| `ALLOWED_ORIGIN` | The Vercel URL of the front end (CORS) |

## The consent flow (the gate)

1. **Start consent** — enter the voice owner's name and answer three checks:
   - Are they 18 or older? **No → refused.** Children's voices are never cloned (matches harness rule G11c: children's data is refused).
   - Are they a public figure (celebrity, politician, etc.)? **Yes → refused.**
   - Is this your own voice, or someone else's who is present and agreeing? (recorded for the log)
2. **Record the consent statement live** — the app shows a sentence with a one-time code, e.g.
   *"My name is Jordan Lee. I agree to let Creator Center make an AI copy of my voice. My code is RIVER-4821."*
   The code expires in 10 minutes and works once. Uploads are not accepted for this step — it must be recorded in the app.
3. **Automatic check** — the backend transcribes the recording (ElevenLabs speech-to-text) and passes it only if the name, the code, and the word "agree" are all present. Fails get a plain-words reason.
4. **Add voice samples** — 1–5 clips. The consent recording itself is **always included** as a sample, so the clone is built partly from the same voice that gave consent.
5. **Held for approval** — the request waits. Travis reviews: plays the consent recording, reads the transcript, sees the checks. **Approve** creates the voice at ElevenLabs; **Reject** deletes the samples.
6. **Use** — type text, get speech. Every generation is logged (length + hash of the text, not the text itself). Downloads are named `AI-voice-…` so they're never mistaken for a real recording.
7. **Revoke** — one button deletes the voice at ElevenLabs and marks consent withdrawn. The consent record stays (it's evidence).

## Rules (deny > require_approval > allow — same order as the Policy Engine)

| ID | Action | Decision |
|---|---|---|
| VC-1 | Clone a voice of someone under 18 | **deny** |
| VC-2 | Clone a public figure | **deny** |
| VC-3 | Create a voice without a passed, unexpired, unused consent | **deny** |
| VC-4 | Create a voice with valid consent | **require_approval** (Travis) |
| VC-5 | Speak with a voice that isn't approved/active | **deny** |
| VC-6 | Speak with an active voice (≤ 1,000 characters) | allow |
| VC-7 | Revoke a voice | allow (always) |
| VC-8 | Edit or delete audit log entries | **deny** (no route exists) |

## Honest limits of v1

- The system **cannot prove** the samples are the same person as the consent speaker. Mitigation: the consent recording is always a sample, and Travis reviews before approval.
- With a single owner, "approval" is the same person who requested it. It's still a deliberate second look, but it isn't separation of duties (G8b). That arrives when there are accounts.
- No audio watermark. ElevenLabs keeps its own records, and downloads are labeled AI.
- Social publishing and cloud scheduling are still not included (unchanged from the original build).

## Next steps after v1

- Accounts + per-user voice ownership; a second approver for separation of duties.
- Wire decisions into the Warehouse Decision Ledger.
- Sign the consent record with the Index of Flow key card.

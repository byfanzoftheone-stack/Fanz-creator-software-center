# Handoff — Infrastructure, Domains & Creator Center (Oct 3–5, 2026)

**Owner:** Travis Jacobs (byfanzoftheone) · **Written by:** Claude · **Session dates:** Oct 3–5, 2026
**No keys or passwords are in this file — on purpose.**

---

## Why this work happened (the bigger picture)

1. **Keep the flow flowing.** A Railway outage (alongside a Claude outage) once froze the Warehouse, MCP brain, Canvas Gateway and governed work all at once. Goal: Railway stays the main home, but no single provider can stop THE ONE. Claude stays core — nothing here replaces it.
2. **Own the front door.** Seven domains were bought so every product lives at an address *you* control. When an address is yours, you can point it anywhere — that's what makes a standby possible.
3. **Creator Center becomes a real tool** inside **FanzAgent Systems** — creator tools plus a **consent-first voice clone**, so Echo can have one consistent voice that has a documented, consented human source (your own voice).
4. **One flagship before multiplying.** The Compadres is the planned Play Store flagship; everything else connects to it through your domains.

---

## ✅ What is LIVE right now

| Thing | Where | Status |
|---|---|---|
| Creator Center front end | https://fanz-creator-center.vercel.app | Live |
| Creator Center on your domain | https://creator.fanzagentsystems.online | DNS set (grey cloud) — confirm it loads |
| Voice backend (Node/Express) | https://voice-backend-production-a881.up.railway.app/health | Live, database connected |
| Code | GitHub `byfanzoftheone-stack/Fanz-creator-software-center` (branch `main`) | Railway + Vercel auto-deploy on every push |
| fanzagentsystems.online | Cloudflare (Free plan) | **Active** — nameservers moved from Namecheap |

### Railway
- **Project:** `creator-center-voice` (ID `8e506722-7793-46aa-94d4-b9f627938cf8`)
- **Services:** `Postgres` + `voice-backend` (ID `be0460da-3908-4a6d-af0d-947675135214`)
- **Settings (your standard):** Root Directory `backend` · Build `npm install` · Start `node server.js` · Health check `/health` · **Restart policy: ALWAYS**
- **Variables set:** `DATABASE_URL` (from Postgres), `PORT=8080`, `NODE_ENV=production`, `ALLOWED_ORIGIN` (the 3 site addresses below)
- **Variables YOU still need to add** (Railway → creator-center-voice → voice-backend → Variables — never in chat):
  - `OWNER_PASSCODE` — unlocks the voice clone
  - `ELEVENLABS_API_KEY` — from elevenlabs.io/app/settings/api-keys (only text-to-speech, speech-to-text, voices permissions; shown once)

### Vercel
- **Project:** `fanz-creator-center` (team byfanzoftheone's projects), root directory `frontend`
- **Addresses:** `fanz-creator-center.vercel.app`, `fanz-creator-center-byfanzoftheones-projects.vercel.app`, `creator.fanzagentsystems.online` (verified)
- Vercel login-wall ("Vercel Authentication") was **turned off** so the public can open it.

### Cloudflare
- **Account has:** R2 storage buckets `clipsync`, `clip`, `carol-cookbook` · no Workers yet · no KV/D1.
- **fanzagentsystems.online** — Active. DNS records:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | creator | cname.vercel-dns.com | **DNS only (grey)** |

- Rule: anything pointing at **Vercel = grey cloud**. Ignore Cloudflare's yellow "proxying recommended" banner for those.
- Cloudflare's 3 "recommendations" (root address, www, email) are **intentionally not done yet**.

---

## 🌐 Domain plan (Namecheap registrar → Cloudflare DNS)

Bought Oct 5, 2026 for $28.88 total (first-year promo prices). **Renewal ~Oct 5, 2027 — real renewal prices will be higher** (calendar reminder set for Sept 5, 2027).

| Domain | Planned use | Status |
|---|---|---|
| fanzagentsystems.online | FanzAgent Systems hub · `creator.` = Creator Center | ✅ On Cloudflare |
| togetherwearethe.one | Main hub | ⏳ still on Namecheap |
| indexofflow.online | IOF Warehouse | ⏳ |
| fanzmcp.online | MCP brain | ⏳ |
| thecompadres.org | The Compadres (+ privacy policy page for Play Store) | ⏳ |
| cpstories.online | CPstories / NOT ALONE | ⏳ |
| lilpro.site | Little Pro | ⏳ |

**Move each remaining domain the same way:**
1. Cloudflare → Add a domain → Free plan → copy the **two nameservers** (end in `ns.cloudflare.com`).
2. Namecheap → Domain List → Manage → **Domain tab** (NOT Advanced DNS) → Nameservers → **Custom DNS** → paste both → green ✓.
3. Wait for Cloudflare "active" email. Then add records Vercel/Railway show you, in Cloudflare.

---

## 🛡️ Standby plan (agreed design — not built yet)

Railway stays primary. Recommended zero-cost standby, proven on Creator Center first, then Canvas Gateway, MCP brain, FanzAgent:
- **Code:** every backend in GitHub (done for Creator Center).
- **Data copy outside Railway:** **Neon** free Postgres (1 GB/project, pgvector supported, no card) — hourly copy job via GitHub's free automation. Plain Postgres → honors the no-Supabase rule.
- **Standby compute:** **Render** free web services (no card; sleep after 15 min, ~1 min wake).
- **Automatic switch:** a free **Cloudflare Worker** in front of each backend — tries Railway, falls back to Render. Needs your domains on Cloudflare (that's why we moved them).
- **Alerts:** same Worker messages a **Telegram bot** on outage/recovery (UptimeRobot free can't do Telegram and is personal-use only).
- **Governance during outage:** standby is readable; new intake lands in **quarantine** and is replayed through quarantine → promote when Railway returns.
- Note: Claude's Cloudflare connection can read storage but **cannot publish Workers** — Claude writes the Worker, you paste it in the Cloudflare dashboard.
- Accounts you'll create: Neon, Render, Telegram bot (via BotFather; token goes in Cloudflare secrets, never chat).
- Check first: each database fits in 1 GB (Warehouse + vector data is the one to measure).

Evidence behind it: Railway platform outage May 19, 2026 (Google Cloud suspended Railway's account, hours down); a user's Aug 16, 2026 3h40m outage where an ON_FAILURE restart policy left services down. Oracle halved its free tier June 2026; Fly/Heroku free tiers gone; Hugging Face now requires a paid plan to run code in Spaces.

---

## 🎙️ Creator Center & Echo's voice

- **Consent gate (built, 29/29 tests pass):** adult only (VC-1), no public figures (VC-2), recorded consent sentence with one-time 3-word code checked by speech-to-text (VC-3), **your approval** before any voice is created (VC-4), revoke anytime (VC-7), append-only audit log the database itself protects (VC-8). Rules + honest limits in `PLAN.md`.
- **Echo's voice = your own voice** (July 9, 2026 recording, cleaned with ElevenLabs Voice Isolator). You own it and consent yourself.
- **ElevenLabs rule:** their Prohibited Use Policy forbids using ElevenLabs *output* to train any AI. So the "learn for 30 days" idea was dropped **only for that reason**. Allowed: clone your own voice inside ElevenLabs; keep finished audio you generate.
- **Permanent Echo voice:** record an "Echo master set" (5 clips, quiet room, raw files — script was given in chat). That set feeds a future self-hosted model (Chatterbox Turbo, MIT license, built-in watermark) with **sleep mode** on Railway — no subscription.
- **Placement decision:** Creator Center lives in **FanzAgent Systems** (adult). Usable by you as teacher for homeschool materials. **Voice clone stays out of all youth packages** (Little Pro driver's ed etc.) — youth ideas TBD later.
- **To finish:** add the 2 Railway variables → Voice Lab → record sample → passcode → consent as "My own voice" → read sentence → approve → Speak.

---

## 📱 Google Play (The Compadres flagship)

- Play Console sign-up started; **payments identity verification submitted Oct 5, 12:14pm** — wait 72 hrs (reminder Oct 8, 12:30pm).
- Your account is post-2024 → each new app needs a **closed test: 12 testers × 14 days** before going public. $25 one-time fee. ID + address verification required.
- Upload must be an **app bundle (.aab)**, not APK. Privacy policy page needed (plan: thecompadres.org).
- Child-facing version must meet Google Families policy → ship the general/adult version first.

---

## 📅 Calendar reminders set

| Date | Reminder |
|---|---|
| Wed Oct 8, 9:00am | Claude + Railway renew Saturday — have funds ready |
| Wed Oct 8, 12:30pm | Check Google payments verification → continue Play Console |
| Sat Oct 11, 8:00am | Renew today: Claude + Railway |
| Fri Sept 5, 2027 | Check real renewal prices for all 7 domains |

GitHub: no subscription. ElevenLabs: subscribed ~1 month (from Oct 5).

---

## 💡 Ideas parked (not started)
- **Echo receptionist agent** for FanzAgent Systems (ElevenLabs Agents; Claude can build it via the ElevenLabs connection). Real phone number via **Twilio** (or Telnyx/SIP). Google Voice has no API — can't connect.
- **Tutor agent:** adults anytime; kids only after the Compadre child-safety plan.
- **Fresh computer** as a third home (Claude desktop app → "Link to this computer"; not Zoom). Back up before wiping.
- **Media to Cloudflare R2** later (voice clips stay in Postgres for now).

---

## 🧾 On the record (mistakes & corrections)
- Claude first assumed ElevenLabs for the voice engine without asking — corrected after you explained the subscription concern.
- Claude set the voice service restart policy to ON_FAILURE; changed to **ALWAYS** after finding the Aug 16 incident. **Check your other Railway services for the same setting.**
- Vercel created the project with login protection on; Claude turned it off.

---

## ▶️ Next steps, in order
1. Confirm https://creator.fanzagentsystems.online loads (padlock).
2. Add `OWNER_PASSCODE` + `ELEVENLABS_API_KEY` in Railway → put Echo through the consent gate.
3. Oct 8: check Google verification → finish Play Console sign-up.
4. Move the other 6 domains to Cloudflare (same 3 steps).
5. Build the standby (Neon + Render + Worker + Telegram), Creator Center first.
6. Optional: Echo receptionist agent; record the Echo master set.

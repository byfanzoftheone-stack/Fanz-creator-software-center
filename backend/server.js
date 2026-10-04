const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const { pool, init, audit } = require('./db');
const el = require('./elevenlabs');
const policy = require('./policy');

const PORT = process.env.PORT || 3000;
const SESSION_HOURS = 12;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const rand = n => crypto.randomInt(n);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const origins = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                       // curl / server-to-server
    if (!origins.length) return cb(null, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
    cb(null, origins.includes(origin));
  },
  allowedHeaders: ['content-type', 'authorization'],
  exposedHeaders: ['x-audit-id'],
}));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => { res.set('x-content-type-options', 'nosniff'); res.set('cache-control', 'no-store'); next(); });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
const audioOnly = f => /^audio\/|^video\/webm/.test(f.mimetype || '');

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const refuse = (res, d, status = 403) => res.status(status).json({ decision: d.decision, rule: d.rule, reason: d.reason });

// ---- health ---------------------------------------------------------------
app.get('/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'creator-center-voice', elevenlabs_configured: el.configured(), owner_passcode_set: Boolean(process.env.OWNER_PASSCODE) });
}));

// ---- owner login (single owner, passcode in Railway variables) -------------
const failures = new Map(); // ip -> { count, until }
app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip;
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return res.status(429).json({ reason: 'Too many wrong tries. Wait 15 minutes.' });
  const expected = process.env.OWNER_PASSCODE;
  if (!expected) return res.status(503).json({ reason: 'OWNER_PASSCODE is not set in Railway variables yet.' });
  const given = String(req.body?.passcode || '');
  const ok = crypto.timingSafeEqual(Buffer.from(sha256(given), 'hex'), Buffer.from(sha256(expected), 'hex'));
  if (!ok) {
    const n = (f && f.until <= Date.now() ? 0 : (f?.count || 0)) + 1;
    failures.set(ip, { count: n, until: n >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
    await audit('login.failed', { detail: { ip_hash: sha256(ip || '').slice(0, 12) } });
    return res.status(401).json({ reason: 'Wrong passcode.' });
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query('INSERT INTO sessions (token_hash, expires_at) VALUES ($1,$2)', [sha256(token), expires]);
  await audit('login.ok');
  res.json({ token, expires_at: expires });
}));

const requireOwner = wrap(async (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m) return res.status(401).json({ reason: 'Log in first.' });
  const r = await pool.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at > now()', [sha256(m[1])]);
  if (!r.rowCount) return res.status(401).json({ reason: 'Session expired. Log in again.' });
  req.tokenHash = sha256(m[1]);
  next();
});

app.post('/api/logout', requireOwner, wrap(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token_hash=$1', [req.tokenHash]);
  res.json({ ok: true });
}));

app.get('/api/status', requireOwner, (req, res) => res.json({ elevenlabs_configured: el.configured(), max_speak_chars: policy.MAX_SPEAK_CHARS }));

// ---- consent ----------------------------------------------------------------
app.post('/api/consents', requireOwner, wrap(async (req, res) => {
  const b = req.body || {};
  const ctx = {
    owner_name: String(b.owner_name || '').trim().slice(0, 80),
    is_adult: b.is_adult === true,
    is_public_figure: b.is_public_figure === false ? false : true,   // anything but an explicit "no" counts as yes
    relationship: b.relationship === 'self' ? 'self' : 'other_present',
  };
  const d = policy.decide('consent.start', ctx);
  if (d.decision === 'deny') {
    await audit('consent.start', { decision: 'deny', rule: d.rule, detail: { is_adult: ctx.is_adult, is_public_figure: ctx.is_public_figure } });
    return refuse(res, d);
  }
  const code = policy.makeCode(rand);
  const phrase = policy.makePhrase(ctx.owner_name, code);
  const r = await pool.query(
    `INSERT INTO consents (owner_name, relationship, is_adult, is_public_figure, code_words, phrase, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '10 minutes') RETURNING id, expires_at`,
    [ctx.owner_name, ctx.relationship, ctx.is_adult, ctx.is_public_figure, code, phrase]);
  await audit('consent.start', { target: r.rows[0].id, decision: 'allow', rule: d.rule, detail: { relationship: ctx.relationship } });
  res.status(201).json({ id: r.rows[0].id, phrase, expires_at: r.rows[0].expires_at });
}));

app.post('/api/consents/:id/statement', requireOwner, upload.single('audio'), wrap(async (req, res) => {
  const r = await pool.query('SELECT * FROM consents WHERE id=$1', [req.params.id]);
  const c = r.rows[0];
  if (!c) return res.status(404).json({ reason: 'Consent not found.' });
  if (c.status !== 'pending') return res.status(409).json({ reason: `This consent is already ${c.status}. Start a new one.` });
  if (new Date(c.expires_at) < new Date()) {
    await pool.query("UPDATE consents SET status='failed' WHERE id=$1", [c.id]);
    return res.status(410).json({ reason: 'The code expired (10 minutes). Start a new consent.' });
  }
  if (c.attempts >= 3) {
    await pool.query("UPDATE consents SET status='failed' WHERE id=$1", [c.id]);
    return res.status(429).json({ reason: 'Three tries used. Start a new consent.' });
  }
  if (!req.file || !audioOnly(req.file)) return res.status(400).json({ reason: 'Record the statement in the app (audio required).' });
  if (req.file.size < 8000) return res.status(400).json({ reason: 'That recording is too short to hold the whole sentence.' });

  await pool.query('UPDATE consents SET attempts = attempts + 1 WHERE id=$1', [c.id]);
  const transcript = await el.transcribe(req.file.buffer, req.file.mimetype);
  const result = policy.checkStatement(transcript, c.owner_name, c.code_words);
  const status = result.passed ? 'passed' : 'pending';
  await pool.query(
    `UPDATE consents SET status=$2, statement_audio=$3, statement_mime=$4, statement_sha256=$5, transcript=$6, check_detail=$7, checked_at=now() WHERE id=$1`,
    [c.id, status, req.file.buffer, req.file.mimetype, sha256(req.file.buffer), transcript, JSON.stringify(result)]);
  await audit('consent.statement', { target: c.id, decision: result.passed ? 'pass' : 'fail', detail: { checks: result.checks, audio_sha256: sha256(req.file.buffer), attempt: c.attempts + 1 } });
  res.json({ status: result.passed ? 'passed' : 'not_passed', reason: result.reason, checks: result.checks, transcript, attempts_left: result.passed ? 0 : 2 - c.attempts });
}));

app.get('/api/consents/:id/audio', requireOwner, wrap(async (req, res) => {
  const r = await pool.query('SELECT statement_audio, statement_mime FROM consents WHERE id=$1', [req.params.id]);
  if (!r.rows[0]?.statement_audio) return res.status(404).json({ reason: 'No recording.' });
  res.type(r.rows[0].statement_mime || 'audio/webm').send(r.rows[0].statement_audio);
}));

// ---- voices -----------------------------------------------------------------
app.post('/api/voices', requireOwner, upload.array('samples', 4), wrap(async (req, res) => {
  const consentId = String(req.body?.consent_id || '');
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ reason: 'Give the voice a name.' });
  const files = (req.files || []).filter(audioOnly);
  if (!files.length) return res.status(400).json({ reason: 'Add at least one voice sample (the consent statement is added automatically).' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM consents WHERE id=$1 FOR UPDATE', [consentId]);
    const d = policy.decide('voice.create', { consent: r.rows[0] });
    if (d.decision === 'deny') {
      await client.query('ROLLBACK');
      await audit('voice.create', { target: consentId || null, decision: 'deny', rule: d.rule });
      return refuse(res, d);
    }
    const c = r.rows[0];
    const v = await client.query("INSERT INTO voices (consent_id, name) VALUES ($1,$2) RETURNING id, status, created_at", [c.id, name]);
    const vid = v.rows[0].id;
    await client.query('INSERT INTO voice_samples (voice_id, is_consent_statement, data, mime, sha256, size) VALUES ($1,true,$2,$3,$4,$5)',
      [vid, c.statement_audio, c.statement_mime, c.statement_sha256, c.statement_audio.length]);
    for (const f of files)
      await client.query('INSERT INTO voice_samples (voice_id, data, mime, sha256, size) VALUES ($1,$2,$3,$4,$5)', [vid, f.buffer, f.mimetype, sha256(f.buffer), f.size]);
    await client.query("UPDATE consents SET status='used' WHERE id=$1", [c.id]);
    await client.query('COMMIT');
    await audit('voice.create', { target: vid, decision: d.decision, rule: d.rule, detail: { consent_id: c.id, samples: files.length + 1 } });
    res.status(202).json({ id: vid, status: 'held', decision: d.decision, reason: d.reason });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

app.get('/api/voices', requireOwner, wrap(async (req, res) => {
  const r = await pool.query(`
    SELECT v.id, v.name, v.status, v.created_at, v.decided_at, v.revoked_at, v.requires_verification,
           (v.el_voice_id IS NOT NULL) AS cloned,
           c.id AS consent_id, c.owner_name, c.relationship, c.phrase, c.transcript, c.check_detail, c.checked_at, c.statement_sha256,
           (SELECT count(*) FROM voice_samples s WHERE s.voice_id = v.id)::int AS samples_waiting
    FROM voices v JOIN consents c ON c.id = v.consent_id ORDER BY v.created_at DESC`);
  res.json({ voices: r.rows });
}));

async function getVoice(id) { return (await pool.query('SELECT * FROM voices WHERE id=$1', [id])).rows[0]; }

app.post('/api/voices/:id/approve', requireOwner, wrap(async (req, res) => {
  const v = await getVoice(req.params.id);
  if (!v) return res.status(404).json({ reason: 'Voice not found.' });
  if (v.status !== 'held') return res.status(409).json({ reason: `Voice is ${v.status}, not waiting for approval.` });
  const c = (await pool.query('SELECT owner_name, statement_sha256 FROM consents WHERE id=$1', [v.consent_id])).rows[0];
  const samples = (await pool.query('SELECT data, mime FROM voice_samples WHERE voice_id=$1 ORDER BY id', [v.id])).rows;
  const out = await el.createVoice(v.name, `Consent-verified voice of ${c.owner_name}. Consent record ${v.consent_id} (sha256 ${c.statement_sha256.slice(0, 16)}).`, samples);
  await pool.query("UPDATE voices SET status='active', el_voice_id=$2, requires_verification=$3, decided_at=now() WHERE id=$1", [v.id, out.voice_id, Boolean(out.requires_verification)]);
  await pool.query('DELETE FROM voice_samples WHERE voice_id=$1', [v.id]);   // samples aren't kept once the voice exists
  await audit('voice.approve', { target: v.id, decision: 'approved', rule: 'VC-4', detail: { requires_verification: Boolean(out.requires_verification) } });
  res.json({ id: v.id, status: 'active', requires_verification: Boolean(out.requires_verification) });
}));

app.post('/api/voices/:id/reject', requireOwner, wrap(async (req, res) => {
  const v = await getVoice(req.params.id);
  if (!v) return res.status(404).json({ reason: 'Voice not found.' });
  if (v.status !== 'held') return res.status(409).json({ reason: `Voice is ${v.status}, not waiting for approval.` });
  await pool.query("UPDATE voices SET status='rejected', decided_at=now() WHERE id=$1", [v.id]);
  await pool.query('DELETE FROM voice_samples WHERE voice_id=$1', [v.id]);
  await audit('voice.reject', { target: v.id, decision: 'rejected', rule: 'VC-4' });
  res.json({ id: v.id, status: 'rejected' });
}));

app.post('/api/voices/:id/speak', requireOwner, wrap(async (req, res) => {
  const v = await getVoice(req.params.id);
  const text = String(req.body?.text || '');
  const d = policy.decide('voice.speak', { voice: v, text });
  if (d.decision === 'deny') {
    await audit('voice.speak', { target: req.params.id, decision: 'deny', rule: d.rule });
    return refuse(res, d);
  }
  const audio = await el.speak(v.el_voice_id, text.trim());
  await audit('voice.speak', { target: v.id, decision: 'allow', rule: d.rule, detail: { chars: text.trim().length, text_sha256: sha256(text.trim()) } });
  res.type('audio/mpeg').send(audio);
}));

app.delete('/api/voices/:id', requireOwner, wrap(async (req, res) => {
  const v = await getVoice(req.params.id);
  if (!v) return res.status(404).json({ reason: 'Voice not found.' });
  if (v.status === 'revoked') return res.json({ id: v.id, status: 'revoked' });
  if (v.el_voice_id) await el.deleteVoice(v.el_voice_id);
  await pool.query("UPDATE voices SET status='revoked', revoked_at=now() WHERE id=$1", [v.id]);
  await pool.query('DELETE FROM voice_samples WHERE voice_id=$1', [v.id]);
  await pool.query("UPDATE consents SET status='withdrawn' WHERE id=$1", [v.consent_id]);
  await audit('voice.revoke', { target: v.id, decision: 'allow', rule: 'VC-7' });
  res.json({ id: v.id, status: 'revoked' });
}));

app.get('/api/audit', requireOwner, wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const r = await pool.query('SELECT id, at, action, target, decision, rule, detail FROM audit ORDER BY id DESC LIMIT $1', [limit]);
  res.json({ entries: r.rows });
}));

// ---- errors -----------------------------------------------------------------
app.use((req, res) => res.status(404).json({ reason: 'Not found.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) return res.status(413).json({ reason: `Upload problem: ${err.message}. Keep each clip under 10 MB.` });
  if (err instanceof el.ElevenLabsError) return res.status(err.status).json({ reason: err.message });
  if (err?.code === '22P02') return res.status(404).json({ reason: 'Not found.' }); // bad uuid
  console.error(err);
  res.status(500).json({ reason: 'Something went wrong on the server.' });
});

init()
  .then(() => app.listen(PORT, () => console.log(`creator-center-voice listening on ${PORT}`)))
  .catch(e => { console.error('Database setup failed:', e.message); process.exit(1); });

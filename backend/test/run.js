// End-to-end test of the consent gate against a fake ElevenLabs and a real Postgres.
// Usage: DATABASE_URL=postgres://... node test/run.js
const { spawn } = require('child_process');
const path = require('path');
const { startMock } = require('./mock-elevenlabs');

const API = 'http://127.0.0.1:5602';
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra ? '  → ' + extra : ''}`); };
const fakeAudio = text => new Blob([text.padEnd(9000, '\0')], { type: 'audio/webm' });

async function j(method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer(), ct, headers: r.headers };
}

(async () => {
  const mock = await startMock(5601);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '5602', OWNER_PASSCODE: 'test-passcode-123', ELEVENLABS_API_KEY: 'test', ELEVENLABS_BASE_URL: 'http://127.0.0.1:5601', ALLOWED_ORIGIN: 'https://creator.example' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(r => srv.stdout.on('data', d => String(d).includes('listening') && r()));
  try {
    let r = await j('GET', '/health');
    ok(r.status === 200 && r.body.ok && r.body.elevenlabs_configured, 'health is up and ElevenLabs configured');

    r = await j('GET', '/api/voices');
    ok(r.status === 401, 'API refuses without login');
    r = await j('POST', '/api/login', { body: { passcode: 'nope' } });
    ok(r.status === 401, 'wrong passcode refused');
    r = await j('POST', '/api/login', { body: { passcode: 'test-passcode-123' } });
    ok(r.status === 200 && r.body.token, 'right passcode logs in');
    const token = r.body.token;

    r = await j('POST', '/api/consents', { token, body: { owner_name: 'Jordan Lee', is_adult: false, is_public_figure: false, relationship: 'self' } });
    ok(r.status === 403 && r.body.rule === 'VC-1', 'VC-1: under-18 voice refused, with reason', JSON.stringify(r.body));
    r = await j('POST', '/api/consents', { token, body: { owner_name: 'Jordan Lee', is_adult: true, is_public_figure: true } });
    ok(r.status === 403 && r.body.rule === 'VC-2', 'VC-2: public figure refused');
    r = await j('POST', '/api/consents', { token, body: { owner_name: 'Jordan Lee', is_adult: true } });
    ok(r.status === 403 && r.body.rule === 'VC-2', 'VC-2: unanswered public-figure question counts as yes');
    r = await j('POST', '/api/consents', { token, body: { owner_name: 'Jordan', is_adult: true, is_public_figure: false } });
    ok(r.status === 403, 'first and last name required');

    r = await j('POST', '/api/consents', { token, body: { owner_name: 'Jordan Lee', is_adult: true, is_public_figure: false, relationship: 'self' } });
    ok(r.status === 201 && /My code is \w+ \w+ \w+\.$/.test(r.body.phrase), 'consent starts and returns a 3-word code phrase', r.body.phrase);
    const consent = r.body;

    // voice creation before consent passes
    let fd = new FormData(); fd.append('consent_id', consent.id); fd.append('name', 'Jordan'); fd.append('samples', fakeAudio('sample one'), 's.webm');
    r = await j('POST', '/api/voices', { token, form: fd });
    ok(r.status === 403 && r.body.rule === 'VC-3', 'VC-3: cannot create voice before consent passes');

    fd = new FormData(); fd.append('audio', fakeAudio('My name is Jordan Lee. I would like a voice.'), 'c.webm');
    r = await j('POST', `/api/consents/${consent.id}/statement`, { token, form: fd });
    ok(r.status === 200 && r.body.status === 'not_passed' && !r.body.checks.code_spoken && !r.body.checks.agreement_spoken, 'statement missing code + "agree" does not pass, says why', r.body.reason);

    fd = new FormData(); fd.append('audio', fakeAudio(consent.phrase.toUpperCase().replace(/\./g, ',')), 'c.webm');
    r = await j('POST', `/api/consents/${consent.id}/statement`, { token, form: fd });
    ok(r.status === 200 && r.body.status === 'passed', 'correct statement passes (case/punctuation tolerant)', JSON.stringify(r.body));

    fd = new FormData(); fd.append('consent_id', consent.id); fd.append('name', 'Jordan voice');
    fd.append('samples', fakeAudio('sample one'), 's1.webm'); fd.append('samples', fakeAudio('sample two'), 's2.webm');
    r = await j('POST', '/api/voices', { token, form: fd });
    ok(r.status === 202 && r.body.status === 'held' && r.body.decision === 'require_approval', 'VC-4: valid consent → voice held for approval');
    const voiceId = r.body.id;

    fd = new FormData(); fd.append('consent_id', consent.id); fd.append('name', 'again'); fd.append('samples', fakeAudio('x'), 's.webm');
    r = await j('POST', '/api/voices', { token, form: fd });
    ok(r.status === 403 && r.body.rule === 'VC-3', 'consent is single-use');

    r = await j('POST', `/api/voices/${voiceId}/speak`, { token, body: { text: 'hello' } });
    ok(r.status === 403 && r.body.rule === 'VC-5', 'VC-5: held voice cannot speak');

    r = await j('GET', '/api/voices', { token });
    ok(r.body.voices[0].samples_waiting === 3 && r.body.voices[0].transcript, 'review shows consent transcript and 3 samples (2 + consent statement)');
    r = await j('GET', `/api/consents/${consent.id}/audio`, { token });
    ok(r.status === 200 && r.ct.startsWith('audio/'), 'consent recording can be played back for review');

    r = await j('POST', `/api/voices/${voiceId}/approve`, { token });
    const add = mock.calls.find(c => c.op === 'add');
    ok(r.status === 200 && r.body.status === 'active' && add?.files === 3, 'approve creates the voice at ElevenLabs with consent statement included');
    r = await j('GET', '/api/voices', { token });
    ok(r.body.voices[0].samples_waiting === 0, 'raw samples deleted after cloning');

    r = await j('POST', `/api/voices/${voiceId}/speak`, { token, body: { text: 'This is a test of the voice.' } });
    ok(r.status === 200 && r.ct.startsWith('audio/mpeg'), 'VC-6: active voice speaks');
    r = await j('POST', `/api/voices/${voiceId}/speak`, { token, body: { text: 'x'.repeat(1001) } });
    ok(r.status === 403 && r.body.rule === 'VC-6', 'VC-6: over 1,000 characters refused');

    r = await j('DELETE', `/api/voices/${voiceId}`, { token });
    ok(r.status === 200 && mock.calls.some(c => c.op === 'delete'), 'VC-7: revoke deletes the voice at ElevenLabs');
    r = await j('POST', `/api/voices/${voiceId}/speak`, { token, body: { text: 'hello' } });
    ok(r.status === 403 && r.body.rule === 'VC-5', 'revoked voice cannot speak');

    // second consent → reject path
    r = await j('POST', '/api/consents', { token, body: { owner_name: 'Sam Rivers', is_adult: true, is_public_figure: false, relationship: 'other_present' } });
    const c2 = r.body;
    fd = new FormData(); fd.append('audio', fakeAudio(c2.phrase), 'c.webm');
    await j('POST', `/api/consents/${c2.id}/statement`, { token, form: fd });
    fd = new FormData(); fd.append('consent_id', c2.id); fd.append('name', 'Sam'); fd.append('samples', fakeAudio('s'), 's.webm');
    r = await j('POST', '/api/voices', { token, form: fd });
    r = await j('POST', `/api/voices/${r.body.id}/reject`, { token });
    ok(r.status === 200 && r.body.status === 'rejected', 'reject path works');

    r = await j('GET', '/api/audit', { token });
    const actions = r.body.entries.map(e => `${e.action}:${e.decision}`);
    ok(actions.includes('consent.start:deny') && actions.includes('voice.approve:approved') && actions.includes('voice.revoke:allow'), 'audit log recorded refusals, approval and revoke');
    ok(!JSON.stringify(r.body).includes('This is a test of the voice'), 'audit stores a hash of spoken text, not the text');

    const { Client } = require('pg'); const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
    let blocked = false; try { await db.query('DELETE FROM audit'); } catch { blocked = true; }
    ok(blocked, 'VC-8: database refuses deleting audit entries'); await db.end();

    const cr = await fetch(API + '/health', { headers: { origin: 'https://evil.example' } });
    ok(!cr.headers.get('access-control-allow-origin'), 'CORS: unknown website gets no access');
    const cg = await fetch(API + '/health', { headers: { origin: 'https://creator.example' } });
    ok(cg.headers.get('access-control-allow-origin') === 'https://creator.example', 'CORS: the Creator Center site is allowed');
  } catch (e) { fail++; console.error('ERROR', e); }
  srv.kill(); mock.server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

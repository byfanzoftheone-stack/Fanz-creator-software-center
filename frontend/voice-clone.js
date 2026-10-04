// Consent-first voice cloning panel for the Voice Lab.
// Talks only to the Creator Center backend (API base in config.js). The ElevenLabs key never reaches the browser.
(() => {
  'use strict';
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const apiBase = () => {
    let saved = null; try { saved = localStorage.getItem('cc.apiBase'); } catch { /* ignore */ }
    return (saved || (window.CC_CONFIG && window.CC_CONFIG.apiBase) || '').replace(/\/$/, '');
  };
  let token = store.get('cc.voiceToken');
  let H = null;           // helpers from app.js
  let el = null;          // panel root
  let consent = null;     // { id, phrase, expires_at, owner_name }
  let statementBlob = null;
  let rec = null, recChunks = [], recStream = null, expiryTimer = null;
  let lastSpoken = {};    // voiceId -> Blob

  async function api(method, path, { body, form, raw } = {}) {
    const base = apiBase();
    if (!base) throw new Error('No backend address set. Add it in config.js or below.');
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    let res;
    try { res = await fetch(base + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) }); }
    catch { throw new Error('Could not reach the voice backend. Check the address and that Railway is running.'); }
    if (res.status === 401 && path !== '/api/login') { token = null; store.set('cc.voiceToken', null); render(); }
    if (raw && res.ok) return res.blob();
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : {};
    if (!res.ok) { const e = new Error(data.reason || `Request failed (${res.status})`); e.data = data; e.status = res.status; throw e; }
    return data;
  }

  const esc = s => H.escapeHTML(s == null ? '' : String(s));
  const tick = b => (b ? '<span class="ck ok">✓</span>' : '<span class="ck no">✗</span>');

  function mount(root, helpers) {
    H = helpers;
    el = document.createElement('section');
    el.className = 'clone-panel glass-card';
    el.id = 'clonePanel';
    root.appendChild(el);
    render();
  }

  async function render() {
    if (!el || !document.body.contains(el)) return;
    if (!token) return renderLogin();
    el.innerHTML = `
      <div class="clone-head"><div><div class="eyebrow">CONSENT-FIRST VOICE CLONE</div><h2>Make an AI copy of a voice — only with permission</h2></div>
        <button class="ghost-button" id="cloneLogout">Lock</button></div>
      <div id="cloneStatus" class="notice">Checking backend…</div>
      <div class="clone-grid">
        <div class="clone-steps" id="cloneSteps"></div>
        <div class="clone-voices"><h3>Voices</h3><div id="cloneVoices"><div class="empty"><strong>Loading…</strong></div></div>
          <details class="clone-audit"><summary>Audit log</summary><div id="cloneAudit" class="muted small">Open to load.</div></details></div>
      </div>`;
    el.querySelector('#cloneLogout').onclick = async () => { try { await api('POST', '/api/logout'); } catch { /* ignore */ } token = null; store.set('cc.voiceToken', null); render(); };
    el.querySelector('.clone-audit').ontoggle = e => e.target.open && loadAudit();
    renderSteps();
    try {
      const s = await api('GET', '/api/status');
      el.querySelector('#cloneStatus').innerHTML = s.elevenlabs_configured
        ? 'Backend connected. Every new voice needs a recorded consent statement and your approval.'
        : '<b>Backend connected, but ElevenLabs isn\'t set up yet.</b> Add <code>ELEVENLABS_API_KEY</code> in Railway variables. Until then the consent check and cloning can\'t run.';
    } catch (e) { el.querySelector('#cloneStatus').textContent = e.message; }
    loadVoices();
  }

  function renderLogin() {
    el.innerHTML = `
      <div class="clone-head"><div><div class="eyebrow">CONSENT-FIRST VOICE CLONE</div><h2>Locked</h2></div></div>
      <p class="muted">Voice cloning is private to the owner. Enter your passcode to unlock it on this device (stays unlocked for 12 hours or until you close the tab).</p>
      <div class="clone-login">
        <div class="field"><label for="clonePass">Owner passcode</label><input id="clonePass" type="password" autocomplete="current-password"></div>
        <button class="primary-button" id="cloneLogin">Unlock</button>
      </div>
      <details class="small muted" style="margin-top:12px"><summary>Backend address</summary>
        <div class="field" style="margin-top:8px"><input id="cloneApi" value="${esc(apiBase())}" placeholder="https://your-backend.up.railway.app"></div>
        <button class="ghost-button" id="cloneApiSave" style="margin-top:8px">Save address</button></details>
      <div id="cloneMsg" class="clone-msg" role="alert"></div>`;
    const go = async () => {
      const msg = el.querySelector('#cloneMsg'); msg.textContent = '';
      try { const r = await api('POST', '/api/login', { body: { passcode: el.querySelector('#clonePass').value } }); token = r.token; store.set('cc.voiceToken', token); render(); }
      catch (e) { msg.textContent = e.message; }
    };
    el.querySelector('#cloneLogin').onclick = go;
    el.querySelector('#clonePass').onkeydown = e => e.key === 'Enter' && go();
    el.querySelector('#cloneApiSave').onclick = () => { try { localStorage.setItem('cc.apiBase', el.querySelector('#cloneApi').value.trim()); } catch { /* ignore */ } H.showToast('Backend address saved.'); };
  }

  // ---- steps ---------------------------------------------------------------
  function renderSteps() {
    const box = el.querySelector('#cloneSteps');
    if (!consent) {
      box.innerHTML = `
        <h3><span class="step-n">1</span> Who is the voice?</h3>
        <div class="field"><label for="cOwner">Voice owner's full name</label><input id="cOwner" maxlength="80" placeholder="First and last name"></div>
        <div class="field"><label for="cRel">Whose voice is it?</label><select id="cRel"><option value="self">My own voice</option><option value="other_present">Someone else, who is here and agreeing</option></select></div>
        <div class="field-row">
          <div class="field"><label for="cAdult">Are they 18 or older?</label><select id="cAdult"><option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option></select></div>
          <div class="field"><label for="cPublic">Are they a public figure?</label><select id="cPublic"><option value="">Choose…</option><option value="no">No</option><option value="yes">Yes</option></select></div>
        </div>
        <p class="muted small">Public figure means a celebrity, politician, broadcaster, or anyone widely known by voice. Children's and public figures' voices are never cloned.</p>
        <button class="primary-button" id="cStart">Get consent statement</button>
        <div id="cMsg" class="clone-msg" role="alert"></div>`;
      box.querySelector('#cStart').onclick = startConsent;
      return;
    }
    if (consent.status !== 'passed') {
      box.innerHTML = `
        <h3><span class="step-n">2</span> ${esc(consent.owner_name)} reads this out loud</h3>
        <blockquote class="phrase">${esc(consent.phrase)}</blockquote>
        <p class="muted small">Record it live, in a quiet place, in ${esc(consent.owner_name.split(' ')[0])}'s own voice. The code works once and expires <b id="cExpiry"></b>.</p>
        <div class="transport"><button class="record-button" id="cRec" title="Record consent"></button><div><b id="cRecStatus">${statementBlob ? 'Recording ready' : 'Tap to record'}</b><div class="muted small">Tap again to stop.</div></div></div>
        <audio id="cPlay" controls style="width:100%;margin-top:10px" ${statementBlob ? '' : 'hidden'}></audio>
        <div class="clone-actions"><button class="primary-button" id="cCheck" ${statementBlob ? '' : 'disabled'}>Check consent</button><button class="ghost-button" id="cCancel">Start over</button></div>
        <div id="cMsg" class="clone-msg" role="alert"></div><div id="cResult"></div>`;
      if (statementBlob) box.querySelector('#cPlay').src = URL.createObjectURL(statementBlob);
      box.querySelector('#cRec').onclick = toggleRec;
      box.querySelector('#cCheck').onclick = checkStatement;
      box.querySelector('#cCancel').onclick = resetConsent;
      startExpiryClock();
      return;
    }
    const lib = H.state.media.filter(m => (m.type || '').startsWith('audio/'));
    const cur = H.getCurrentSample && H.getCurrentSample();
    box.innerHTML = `
      <h3><span class="step-n">3</span> Add voice samples</h3>
      <div class="notice ok-notice">Consent passed for <b>${esc(consent.owner_name)}</b>. The consent recording is included as a sample automatically.</div>
      <p class="muted small">Pick 1–4 more clips of the same person talking naturally (30 seconds to a few minutes each works best).</p>
      <div class="sample-list">
        ${cur ? `<label class="sample-row"><input type="checkbox" value="__current" checked> Current Voice Lab recording <small>${H.bytes(cur.size)}</small></label>` : ''}
        ${lib.map(m => `<label class="sample-row"><input type="checkbox" value="${esc(m.id)}"> ${esc(m.name)} <small>${H.bytes(m.size)}</small></label>`).join('') || (cur ? '' : '<div class="empty"><strong>No audio yet</strong>Record a sample above (Source Audio) or add audio in the Media Library.</div>')}
      </div>
      <div class="field"><label for="cName">Voice name</label><input id="cName" maxlength="60" value="${esc(consent.owner_name)} voice"></div>
      <div class="clone-actions"><button class="primary-button" id="cSubmit">Send for my approval</button><button class="ghost-button" id="cCancel">Start over</button></div>
      <div id="cMsg" class="clone-msg" role="alert"></div>`;
    box.querySelector('#cSubmit').onclick = submitVoice;
    box.querySelector('#cCancel').onclick = resetConsent;
  }

  function showMsg(text, kind = 'error') { const m = el.querySelector('#cMsg'); if (m) { m.className = `clone-msg ${kind}`; m.textContent = text; } }
  function resetConsent() { consent = null; statementBlob = null; clearInterval(expiryTimer); renderSteps(); }

  function startExpiryClock() {
    clearInterval(expiryTimer);
    const upd = () => {
      const left = new Date(consent.expires_at) - Date.now();
      const t = el && el.querySelector('#cExpiry'); if (!t) return clearInterval(expiryTimer);
      if (left <= 0) { t.textContent = 'now — start over for a new code'; clearInterval(expiryTimer); return; }
      t.textContent = `in ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
    };
    upd(); expiryTimer = setInterval(upd, 1000);
  }

  async function startConsent() {
    const owner = el.querySelector('#cOwner').value.trim();
    const adult = el.querySelector('#cAdult').value, pub = el.querySelector('#cPublic').value;
    if (!adult || !pub) return showMsg('Answer both questions first.');
    try {
      const r = await api('POST', '/api/consents', { body: { owner_name: owner, relationship: el.querySelector('#cRel').value, is_adult: adult === 'yes', is_public_figure: pub === 'no' ? false : true } });
      consent = { ...r, owner_name: owner, status: 'pending' }; statementBlob = null; renderSteps();
      H.logActivity('Voice consent started', owner, '◉');
    } catch (e) { showMsg(e.data?.rule ? `Refused (${e.data.rule}): ${e.message}` : e.message); }
  }

  async function toggleRec() {
    const btn = el.querySelector('#cRec'), st = el.querySelector('#cRecStatus');
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showMsg('This browser can\'t record audio.');
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = []; rec = new MediaRecorder(recStream);
      rec.ondataavailable = e => e.data.size && recChunks.push(e.data);
      rec.onstop = () => { statementBlob = new Blob(recChunks, { type: rec.mimeType || 'audio/webm' }); recStream.getTracks().forEach(t => t.stop()); renderSteps(); };
      rec.start(); btn.classList.add('recording'); st.textContent = 'Recording… tap to stop';
    } catch { showMsg('Microphone permission was not granted.'); }
  }

  async function checkStatement() {
    const btn = el.querySelector('#cCheck'); btn.disabled = true; btn.textContent = 'Checking…';
    const fd = new FormData(); fd.append('audio', statementBlob, 'consent.webm');
    try {
      const r = await api('POST', `/api/consents/${consent.id}/statement`, { form: fd });
      if (r.status === 'passed') { consent.status = 'passed'; H.logActivity('Voice consent passed', consent.owner_name, '◉'); renderSteps(); H.showToast('Consent passed.'); return; }
      el.querySelector('#cResult').innerHTML = `<div class="check-list">${tick(r.checks.name_spoken)} Name heard ${tick(r.checks.code_spoken)} Code heard ${tick(r.checks.agreement_spoken)} "Agree" heard</div><p class="muted small">Heard: “${esc(r.transcript)}”</p>`;
      showMsg(`${r.reason} ${r.attempts_left > 0 ? `${r.attempts_left} tr${r.attempts_left === 1 ? 'y' : 'ies'} left.` : ''}`);
      statementBlob = null; el.querySelector('#cCheck').textContent = 'Check consent';
    } catch (e) { showMsg(e.message); btn.disabled = false; btn.textContent = 'Check consent'; if (e.status === 410 || e.status === 429 || e.status === 409) setTimeout(resetConsent, 2500); }
  }

  async function submitVoice() {
    const picks = [...el.querySelectorAll('.sample-list input:checked')].map(i => i.value);
    if (!picks.length) return showMsg('Pick at least one sample.');
    if (picks.length > 4) return showMsg('Pick up to 4 samples.');
    const fd = new FormData(); fd.append('consent_id', consent.id); fd.append('name', el.querySelector('#cName').value.trim());
    for (const id of picks) {
      const blob = id === '__current' ? H.getCurrentSample() : await H.getBlob(id);
      if (blob) fd.append('samples', blob, `sample.${(blob.type || '').includes('mpeg') ? 'mp3' : 'webm'}`);
    }
    try {
      await api('POST', '/api/voices', { form: fd });
      H.logActivity('Voice sent for approval', consent.owner_name, '◉'); H.showToast('Held for your approval.');
      resetConsent(); loadVoices();
    } catch (e) { showMsg(e.data?.rule ? `Refused (${e.data.rule}): ${e.message}` : e.message); }
  }

  // ---- voices list -----------------------------------------------------------
  async function loadVoices() {
    const box = el && el.querySelector('#cloneVoices'); if (!box) return;
    let voices;
    try { voices = (await api('GET', '/api/voices')).voices; } catch (e) { box.innerHTML = `<div class="clone-msg error">${esc(e.message)}</div>`; return; }
    if (!voices.length) { box.innerHTML = '<div class="empty"><strong>No voices yet</strong>Start with step 1.</div>'; return; }
    box.innerHTML = voices.map(v => {
      const checks = v.check_detail?.checks || {};
      return `<article class="voice-card" data-id="${esc(v.id)}">
        <header><b>${esc(v.name)}</b><span class="vstatus ${esc(v.status)}">${v.status === 'held' ? 'waiting for you' : esc(v.status)}</span></header>
        <p class="muted small">${esc(v.owner_name)} • ${v.relationship === 'self' ? 'own voice' : 'someone present'} • consent ${new Date(v.checked_at).toLocaleString()}</p>
        ${v.status === 'held' ? `
          <div class="review"><div class="eyebrow">REVIEW BEFORE APPROVING</div>
            <audio controls preload="none" data-consent="${esc(v.consent_id)}"></audio>
            <p class="small">Asked to say: “${esc(v.phrase)}”</p><p class="small muted">Heard: “${esc(v.transcript)}”</p>
            <div class="check-list">${tick(checks.name_spoken)} Name ${tick(checks.code_spoken)} Code ${tick(checks.agreement_spoken)} Agree</div>
            <p class="small muted">${v.samples_waiting} sample${v.samples_waiting === 1 ? '' : 's'} waiting (includes the consent recording). Listen: is it the same person?</p>
            <div class="clone-actions"><button class="primary-button act" data-act="approve">Approve & create voice</button><button class="danger-button act" data-act="reject">Reject</button></div></div>` : ''}
        ${v.status === 'active' ? `
          ${v.requires_verification ? '<div class="notice">ElevenLabs asks for extra verification on this voice — check your ElevenLabs account.</div>' : ''}
          <div class="field"><textarea class="speak-text" maxlength="1000" placeholder="Type what the voice should say (up to 1,000 characters)"></textarea></div>
          <div class="clone-actions"><button class="primary-button act" data-act="speak">Speak</button><button class="danger-button act" data-act="revoke">Revoke voice</button></div>
          <div class="speak-out"></div>` : ''}
        <div class="clone-msg"></div>
      </article>`;
    }).join('');
    box.querySelectorAll('audio[data-consent]').forEach(a => a.addEventListener('play', async () => {
      if (a.src) return;
      try { a.src = URL.createObjectURL(await api('GET', `/api/consents/${a.dataset.consent}/audio`, { raw: true })); a.play(); } catch (e) { H.showToast(e.message); }
    }, { once: false }));
    box.querySelectorAll('.act').forEach(b => b.onclick = () => act(b.closest('.voice-card'), b.dataset.act, b));
  }

  async function act(card, what, btn) {
    const id = card.dataset.id, msg = card.querySelector('.clone-msg');
    const say = (t, k = 'error') => { msg.className = `clone-msg ${k}`; msg.textContent = t; };
    try {
      if (what === 'approve') {
        if (!confirm('Approve? This creates the voice at ElevenLabs. Only approve if the consent recording and samples are the same person.')) return;
        btn.disabled = true; btn.textContent = 'Creating…';
        await api('POST', `/api/voices/${id}/approve`); H.logActivity('Voice approved', '', '◉'); H.showToast('Voice created.'); return loadVoices();
      }
      if (what === 'reject') {
        if (!confirm('Reject and delete the samples?')) return;
        await api('POST', `/api/voices/${id}/reject`); return loadVoices();
      }
      if (what === 'revoke') {
        if (!confirm('Revoke this voice? It is deleted at ElevenLabs and can\'t speak again. The consent record is kept.')) return;
        await api('DELETE', `/api/voices/${id}`); H.logActivity('Voice revoked', '', '◉'); H.showToast('Voice revoked.'); return loadVoices();
      }
      if (what === 'speak') {
        const text = card.querySelector('.speak-text').value;
        btn.disabled = true; btn.textContent = 'Speaking…';
        const blob = await api('POST', `/api/voices/${id}/speak`, { body: { text }, raw: true });
        lastSpoken[id] = blob;
        const out = card.querySelector('.speak-out');
        out.innerHTML = '<audio controls style="width:100%"></audio><div class="clone-actions"><button class="secondary-button" data-x="save">Save to Media Library</button><button class="ghost-button" data-x="dl">Download</button></div><p class="muted small">Saved and downloaded files are labeled AI-voice so they\'re never mistaken for a real recording.</p>';
        out.querySelector('audio').src = URL.createObjectURL(blob);
        const fname = `AI-voice-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp3`;
        out.querySelector('[data-x=dl]').onclick = () => H.downloadBlob(blob, fname);
        out.querySelector('[data-x=save]').onclick = async () => {
          const mid = H.uid('m'); await H.putBlob(mid, blob);
          H.state.media.unshift({ id: mid, name: fname, type: 'audio/mpeg', size: blob.size, createdAt: Date.now() });
          H.saveState(); H.showToast('Saved to Media Library.');
        };
        btn.disabled = false; btn.textContent = 'Speak'; say('', 'ok');
      }
    } catch (e) { say(e.data?.rule ? `Refused (${e.data.rule}): ${e.message}` : e.message); btn.disabled = false; btn.textContent = btn.dataset.act === 'approve' ? 'Approve & create voice' : btn.dataset.act === 'speak' ? 'Speak' : btn.textContent; }
  }

  async function loadAudit() {
    const box = el.querySelector('#cloneAudit');
    try {
      const { entries } = await api('GET', '/api/audit?limit=40');
      box.innerHTML = entries.map(e => `<div class="audit-row"><time>${new Date(e.at).toLocaleString()}</time> <b>${esc(e.action)}</b> ${e.decision ? `<span class="vstatus ${e.decision === 'deny' ? 'revoked' : 'active'}">${esc(e.decision)}</span>` : ''} ${e.rule ? `<small>${esc(e.rule)}</small>` : ''}</div>`).join('') || 'Nothing logged yet.';
    } catch (e) { box.textContent = e.message; }
  }

  window.VoiceClone = { mount };
})();

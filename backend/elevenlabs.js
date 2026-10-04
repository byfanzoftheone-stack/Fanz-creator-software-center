// Thin ElevenLabs client. The API key is read from the server environment only.
const BASE = (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, '');
const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2';
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2';

const configured = () => Boolean(process.env.ELEVENLABS_API_KEY);

class ElevenLabsError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function call(path, init = {}) {
  if (!configured()) throw new ElevenLabsError('ElevenLabs is not configured yet. Add ELEVENLABS_API_KEY in Railway variables.', 503);
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, ...(init.headers || {}) },
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.detail?.message || j?.detail?.status || JSON.stringify(j?.detail || j); } catch { /* ignore */ }
    throw new ElevenLabsError(`ElevenLabs returned ${res.status}${detail ? `: ${detail}` : ''}`, 502);
  }
  return res;
}

async function transcribe(buffer, mime) {
  const fd = new FormData();
  fd.append('model_id', STT_MODEL);
  fd.append('file', new Blob([buffer], { type: mime || 'audio/webm' }), 'consent.webm');
  const res = await call('/v1/speech-to-text', { method: 'POST', body: fd });
  const j = await res.json();
  return j.text || '';
}

async function createVoice(name, description, samples) {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('description', description);
  fd.append('remove_background_noise', 'true');
  samples.forEach((s, i) => fd.append('files', new Blob([s.data], { type: s.mime || 'audio/webm' }), `sample-${i + 1}.${(s.mime || '').includes('mpeg') ? 'mp3' : (s.mime || '').includes('wav') ? 'wav' : 'webm'}`));
  const res = await call('/v1/voices/add', { method: 'POST', body: fd });
  return res.json(); // { voice_id, requires_verification }
}

async function speak(voiceId, text) {
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: TTS_MODEL }),
  });
  return Buffer.from(await res.arrayBuffer());
}

async function deleteVoice(voiceId) {
  await call(`/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE' });
}

module.exports = { configured, transcribe, createVoice, speak, deleteVoice, ElevenLabsError };

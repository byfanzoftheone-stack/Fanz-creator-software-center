// Fake ElevenLabs for local tests. Speech-to-text returns the uploaded file's bytes
// as text, so a test can "say" any sentence without real audio or real credits.
const express = require('express');
const multer = require('multer');

function startMock(port) {
  const app = express();
  const up = multer({ storage: multer.memoryStorage() });
  const calls = [];
  const auth = (req, res, next) => (req.get('xi-api-key') ? next() : res.status(401).json({ detail: { message: 'no key' } }));
  let nextTranscript = null; // browser tests set what the fake "hears" next
  app.post('/__next_transcript', express.json(), (req, res) => { nextTranscript = req.body.text; res.json({ ok: true }); });
  app.post('/v1/speech-to-text', auth, up.single('file'), (req, res) => {
    calls.push({ op: 'stt', model: req.body.model_id });
    const text = nextTranscript ?? req.file.buffer.toString('utf8').replace(/\0+$/, '');
    nextTranscript = null;
    res.json({ text });
  });
  app.post('/v1/voices/add', auth, up.array('files'), (req, res) => {
    calls.push({ op: 'add', name: req.body.name, files: req.files.length });
    res.json({ voice_id: 'mock_voice_' + calls.length, requires_verification: false });
  });
  app.post('/v1/text-to-speech/:id', auth, express.json(), (req, res) => {
    calls.push({ op: 'tts', id: req.params.id, chars: req.body.text.length });
    res.type('audio/mpeg').send(Buffer.from('ID3fake-mp3'));
  });
  app.delete('/v1/voices/:id', auth, (req, res) => { calls.push({ op: 'delete', id: req.params.id }); res.json({ status: 'ok' }); });
  return new Promise(r => { const s = app.listen(port, () => r({ server: s, calls })); });
}

module.exports = { startMock };

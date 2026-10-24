import express from 'express';
import dotenv from 'dotenv';
import ffmpeg from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(dir, '../.env') });
const env = process.env;

const app = express();
app.use(express.json({ limit: '2mb' }));

const read = async (r) => {
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const post = (url, headers, body) => fetch(url, { method: 'POST', headers, body });

const AZURE = { 'fr-m': 'fr-FR-HenriNeural', 'fr-f': 'fr-FR-DeniseNeural', 'en-m': 'en-US-GuyNeural', 'en-f': 'en-US-JennyNeural' };
const GOOGLE = { 'fr-m': 'fr-FR-Neural2-B', 'fr-f': 'fr-FR-Neural2-A', 'en-m': 'en-US-Neural2-D', 'en-f': 'en-US-Neural2-F' };

const providers = {
  openai: {
    max: 3500,
    ready: () => !!env.OPENAI_API_KEY,
    run: async (t, v) =>
      read(await post('https://api.openai.com/v1/audio/speech',
        { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        JSON.stringify({ model: env.OPENAI_TTS_MODEL || 'tts-1', voice: v.endsWith('m') ? 'onyx' : 'nova', input: t, response_format: 'mp3' }))),
  },
  azure: {
    max: 3000,
    ready: () => !!(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION),
    run: async (t, v) => {
      const name = AZURE[v];
      const ssml = `<speak version="1.0" xml:lang="${name.slice(0, 5)}"><voice name="${name}">${esc(t)}</voice></speak>`;
      return read(await post(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
        { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'voix-locale' }, ssml));
    },
  },
  google: {
    max: 3000,
    ready: () => !!env.GOOGLE_TTS_API_KEY,
    run: async (t, v) => {
      const name = GOOGLE[v];
      const r = await post(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ input: { text: t }, voice: { languageCode: name.slice(0, 5), name }, audioConfig: { audioEncoding: 'MP3' } }));
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
      return Buffer.from((await r.json()).audioContent, 'base64');
    },
  },
  coqui: {
    max: 400,
    ready: () => !!(env.COQUI_URL_FR || env.COQUI_URL_EN),
    run: async (t, v) => {
      const lang = v.slice(0, 2);
      const base = lang === 'fr' ? env.COQUI_URL_FR : env.COQUI_URL_EN;
      if (!base) throw new Error(`COQUI_URL_${lang.toUpperCase()} manquant dans .env`);
      return read(await fetch(`${base}/api/tts?text=${encodeURIComponent(t)}`));
    },
  },
  xtts: {
    max: 400,
    ready: () => !!env.XTTS_URL,
    run: async (t, v) => {
      const speaker = v.endsWith('m') ? env.XTTS_SPEAKER_M || 'Damien Black' : env.XTTS_SPEAKER_F || 'Claribel Dervla';
      const q = new URLSearchParams({ text: t, speaker_id: speaker, language_id: v.slice(0, 2) });
      return read(await fetch(`${env.XTTS_URL}/api/tts?${q}`));
    },
  },
};

// Découpe le texte par phrases en blocs de taille maximale `max`.
function chunk(text, max) {
  const parts = text.match(/[^.!?\n]+[.!?\n]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max) {
      if (cur.trim()) out.push(cur);
      cur = p;
      while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
    } else cur += p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Vitesse / hauteur / volume via ffmpeg, sortie MP3.
const enhance = (buf, { speed, pitch, volume }) =>
  new Promise((resolve, reject) => {
    const tempo = Math.min(2, Math.max(0.5, speed / pitch));
    const af = `aresample=44100,asetrate=${Math.round(44100 * pitch)},aresample=44100,atempo=${tempo.toFixed(4)},volume=${volume}`;
    const p = spawn(ffmpeg, ['-v', 'error', '-i', 'pipe:0', '-af', af, '-ac', '1', '-b:a', '128k', '-f', 'mp3', 'pipe:1']);
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.stdin.on('error', () => {});
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg : ' + err.slice(0, 300)))));
    p.stdin.end(buf);
  });

app.get('/api/providers', (_req, res) =>
  res.json(Object.fromEntries(Object.entries(providers).map(([k, p]) => [k, p.ready()]))));

app.post('/api/tts', async (req, res) => {
  try {
    const { text = '', provider = 'openai', voice = 'fr-f' } = req.body;
    const num = (x, d, a, b) => Math.min(b, Math.max(a, Number(x) || d));
    const opts = { speed: num(req.body.speed, 1, 0.5, 2), pitch: num(req.body.pitch, 1, 0.5, 1.5), volume: num(req.body.volume, 1, 0, 2) };
    if (!text.trim()) return res.status(400).json({ error: 'Le texte est vide.' });
    if (text.length > 50000) return res.status(400).json({ error: 'Maximum 50 000 caractères.' });
    const p = providers[provider];
    if (!p || !AZURE[voice]) return res.status(400).json({ error: 'Fournisseur ou voix inconnu.' });
    if (!p.ready()) return res.status(400).json({ error: `Fournisseur « ${provider} » non configuré dans .env.` });
    const bufs = [];
    for (const part of chunk(text, p.max)) bufs.push(await enhance(await p.run(part, voice), opts));
    res.type('audio/mpeg').send(Buffer.concat(bufs));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(dir, '../frontend/dist')));

const port = env.PORT || 3001;
app.listen(port, () => console.log(`Voix locale : http://localhost:${port}`));

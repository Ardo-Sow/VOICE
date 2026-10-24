import { useEffect, useState } from 'react';

const MAX = 50000;
const VOICES = [['fr-m', 'Homme FR'], ['fr-f', 'Femme FR'], ['en-m', 'Homme EN'], ['en-f', 'Femme EN']];
const PROVIDERS = [['openai', 'OpenAI TTS'], ['azure', 'Microsoft Azure'], ['google', 'Google Cloud'], ['coqui', 'Coqui TTS'], ['xtts', 'XTTS-v2 (local)']];

const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
};

async function toWav(blob) {
  const ctx = new AudioContext();
  const ab = await ctx.decodeAudioData(await blob.arrayBuffer());
  const ch = ab.numberOfChannels;
  const len = ab.length * ch * 2;
  const buf = new ArrayBuffer(44 + len);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, ab.sampleRate, true); v.setUint32(28, ab.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len, true);
  const data = Array.from({ length: ch }, (_, i) => ab.getChannelData(i));
  let o = 44;
  for (let i = 0; i < ab.length; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  ctx.close();
  return new Blob([buf], { type: 'audio/wav' });
}

const Slider = ({ label, value, onChange, min, max }) => (
  <label className="block">
    <div className="mb-1 flex justify-between text-sm text-zinc-400">
      <span>{label}</span>
      <span className="tabular-nums text-zinc-200">{value.toFixed(2)}×</span>
    </div>
    <input type="range" min={min} max={max} step="0.05" value={value}
      onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-white" />
  </label>
);

export default function App() {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState('openai');
  const [voice, setVoice] = useState('fr-f');
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const [ready, setReady] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tts-history')) || []; } catch { return []; }
  });

  useEffect(() => { fetch('/api/providers').then((r) => r.json()).then(setReady).catch(() => {}); }, []);
  useEffect(() => {
    try { localStorage.setItem('tts-history', JSON.stringify(history)); } catch { /* quota */ }
  }, [history]);

  async function generate() {
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, provider, voice, speed, pitch, volume }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`);
      const b = await r.blob();
      if (url) URL.revokeObjectURL(url);
      setBlob(b);
      setUrl(URL.createObjectURL(b));
      setHistory((h) => [{ id: Date.now(), date: new Date().toLocaleString('fr-FR'), text, provider, voice, speed, pitch, volume }, ...h].slice(0, 20));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const load = (h) => {
    setText(h.text); setProvider(h.provider); setVoice(h.voice);
    setSpeed(h.speed); setPitch(h.pitch); setVolume(h.volume);
  };

  const btn = 'rounded-full px-4 py-2 text-sm transition focus-visible:outline-2 focus-visible:outline-white';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-white">Voix locale</h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <textarea value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)}
              placeholder="Colle ou écris ton texte ici…"
              className="h-72 w-full resize-y bg-transparent text-base leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600" />
            <div className="flex items-center justify-between pt-2 text-sm text-zinc-500">
              <span className="tabular-nums">{text.length.toLocaleString('fr-FR')} / {MAX.toLocaleString('fr-FR')} caractères</span>
              <button onClick={generate} disabled={loading || !text.trim()}
                className={`${btn} bg-white font-medium text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40`}>
                {loading ? 'Génération…' : "Générer l'audio"}
              </button>
            </div>
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">{error}</p>}

          {url && (
            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <audio src={url} controls autoPlay className="w-full" />
              <div className="flex flex-wrap gap-2">
                <button className={`${btn} border border-zinc-700 hover:bg-zinc-800`} onClick={() => download(blob, 'audio.mp3')}>Télécharger MP3</button>
                <button className={`${btn} border border-zinc-700 hover:bg-zinc-800`}
                  onClick={async () => download(await toWav(blob), 'audio.wav')}>Télécharger WAV</button>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 lg:self-start">
          <label className="block text-sm text-zinc-400">
            Moteur
            <select value={provider} onChange={(e) => setProvider(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-100">
              {PROVIDERS.map(([k, n]) => (
                <option key={k} value={k}>{n}{ready[k] === false ? ' — non configuré' : ''}</option>
              ))}
            </select>
          </label>

          <div>
            <p className="mb-1 text-sm text-zinc-400">Voix</p>
            <div className="grid grid-cols-2 gap-2">
              {VOICES.map(([k, n]) => (
                <button key={k} onClick={() => setVoice(k)} aria-pressed={voice === k}
                  className={`${btn} border ${voice === k ? 'border-white bg-white text-black' : 'border-zinc-700 hover:bg-zinc-800'}`}>{n}</button>
              ))}
            </div>
          </div>

          <Slider label="Vitesse" value={speed} onChange={setSpeed} min={0.5} max={2} />
          <Slider label="Hauteur" value={pitch} onChange={setPitch} min={0.5} max={1.5} />
          <Slider label="Volume" value={volume} onChange={setVolume} min={0} max={2} />
        </aside>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium text-white">Historique</h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">Tes 20 dernières générations apparaîtront ici.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-2xl border border-zinc-800 bg-zinc-900">
            {history.map((h) => (
              <li key={h.id}>
                <button onClick={() => load(h)} className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-zinc-800">
                  <span className="truncate text-sm text-zinc-200">{h.text}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{h.date}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

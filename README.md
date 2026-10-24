# Voix locale — synthèse vocale personnelle

Colle un texte (jusqu'à 50 000 caractères), choisis une voix, génère un MP3. Pas de compte, pas de base de données.

## Lancer

Prérequis : Node.js 18+.

```bash
npm install
# remplis .env (au moins un fournisseur)
npm start
```

Ouvre http://localhost:3001

## Fournisseurs

| Fournisseur | Ce qu'il faut dans `.env` |
|---|---|
| OpenAI TTS | `OPENAI_API_KEY` |
| Microsoft Azure | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Google Cloud TTS | `GOOGLE_TTS_API_KEY` (API Text-to-Speech activée) |
| XTTS-v2 (gratuit, local) | serveur local, voir ci-dessous |
| Coqui TTS (local) | `COQUI_URL_FR` / `COQUI_URL_EN` |

### XTTS-v2 en local (gratuit)

```bash
pip install TTS
tts-server --model_name tts_models/multilingual/multi-dataset/xtts_v2 --port 5002
```

Puis choisis « XTTS-v2 » dans l'interface. Les voix Homme/Femme utilisent `XTTS_SPEAKER_M` / `XTTS_SPEAKER_F` (voix intégrées du modèle). Le clonage de ta propre voix est possible avec XTTS-v2 mais n'est pas branché dans cette version.

### Coqui TTS (modèles mono-locuteur)

```bash
tts-server --model_name tts_models/fr/css10/vits --port 5003
tts-server --model_name tts_models/en/ljspeech/vits --port 5004
```
Puis `COQUI_URL_FR=http://localhost:5003` et `COQUI_URL_EN=http://localhost:5004`. Homme et Femme donnent la même voix avec ces modèles.

## Notes

- Vitesse, hauteur et volume sont appliqués côté serveur avec ffmpeg (fourni par `ffmpeg-static`, rien à installer).
- Les textes longs sont découpés par phrases puis recollés en un seul MP3.
- Le WAV est converti dans le navigateur à partir du MP3.
- L'historique (20 dernières générations) est dans le `localStorage` : il garde le texte et les réglages, pas l'audio. Clique sur une entrée pour la recharger.

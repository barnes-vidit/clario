# Clario

Clario turns any script into a sentence-by-sentence speaking practice session. Upload your speech or presentation notes, and Clario coaches you through it — demonstrating ideal delivery, analysing your attempt acoustically, scoring you on pacing, filler words, pauses, and emphasis, and only advancing when you've genuinely improved.

## Prerequisites

- **Python 3.10+**
- **Node.js 18+**
- **ffmpeg** on your PATH — used for audio conversion (webm → WAV, MP3 → PCM)
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`
  - Windows: [ffmpeg.org/download](https://ffmpeg.org/download.html) → add to PATH

## API Keys (all free tier)

| Service | Purpose | Sign up |
|---------|---------|---------|
| [AssemblyAI](https://www.assemblyai.com) | Speech-to-text | $50 non-expiring credit, no card |
| [Groq](https://console.groq.com) | Script annotation + coaching feedback | Free tier |
| [Google AI Studio](https://aistudio.google.com) | Demo narration (Gemini Live) | Free API key |

## Setup

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # then fill in your API keys
uvicorn main:app --reload --port 8000
```

**`backend/.env`**
```
ASSEMBLYAI_API_KEY=your_key
GROQ_API_KEY=your_key
GROQ_MODEL=llama-3.3-70b-versatile
ASSEMBLYAI_MODEL=universal-2
GEMINI_API_KEY=your_key
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
TTS_IDLE_TIMEOUT_S=90
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env          # default values work for local dev
npm run dev                   # http://localhost:5173
```

**`frontend/.env`**
```
VITE_BACKEND_URL=http://localhost:8000
VITE_BACKEND_WS_URL=ws://localhost:8000
```

## How It Works

1. **Upload** a `.txt`, `.docx`, or `.pdf` script and select your skill level (beginner / intermediate / advanced)
2. **Review** the AI-generated annotations — hero words, target WPM, pause markers — and edit if needed
3. **Practice** sentence by sentence:
   - Listen to the demo narration (Gemini Live with SSML emphasis)
   - Record yourself
   - Get acoustic analysis (pitch, intensity, pauses via librosa) and a score
   - Hear coaching feedback read aloud by the coach voice (edge-tts)
   - Advance when all dimensions pass, or after 3 attempts
4. **Paragraph review** after each paragraph, then a full **session report** with radar charts

## Scoring

All four dimensions must meet the skill-level threshold to advance:

| Dimension | Beginner | Intermediate | Advanced |
|-----------|----------|--------------|----------|
| Pacing | ≥ 60 | ≥ 75 | ≥ 85 |
| Filler words | ≥ 60 | ≥ 80 | ≥ 100 |
| Pauses | ≥ 50 | ≥ 65 | ≥ 80 |
| Emphasis | — | ≥ 60 | ≥ 75 |

After 3 failed attempts the sentence is auto-advanced and flagged for review in the final report.

## Project Structure

```
clario/
├── backend/
│   ├── main.py              # FastAPI app, CORS, rate limiting
│   ├── session_store.py     # In-memory session state
│   ├── requirements.txt
│   └── routers/
│       ├── upload.py        # File parsing + Groq annotation
│       ├── session.py       # Session state CRUD
│       ├── analyse.py       # AssemblyAI STT + librosa analysis
│       ├── feedback.py      # Scoring + Groq coaching text
│       ├── tts.py           # Gemini Live demo narration
│       └── live_coach.py    # WebSocket coach voice (edge-tts)
└── frontend/
    └── src/
        ├── App.jsx
        └── components/
            ├── Onboarding.jsx
            ├── AnnotationReview.jsx
            ├── SessionView.jsx      # Main practice orchestrator
            ├── ScriptPanel.jsx
            ├── RecordButton.jsx
            ├── ScoreCard.jsx
            ├── WaveformVisualiser.jsx
            ├── ParagraphReport.jsx
            └── SessionReport.jsx
```

> **Note:** Sessions are in-memory only — no database. All session data is lost when the backend restarts.

## Deployment

### Backend — Railway or Render

1. Push this repo to GitHub.
2. Create a new **Web Service** pointing to the repo; set the root directory to `backend`.
3. Set **build command**: `pip install -r requirements.txt`
4. Set **start command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add every variable from `backend/.env.example` as a secret env var.
6. Set `ALLOWED_ORIGINS` to your deployed frontend URL, e.g. `https://clario.vercel.app`.

### Frontend — Vercel or Netlify

1. Import the repo and set **root directory** to `frontend`.
2. **Build command**: `npm run build`
3. **Output directory**: `dist`
4. Add env vars:
   - `VITE_BACKEND_URL=https://<your-backend-url>`
   - `VITE_BACKEND_WS_URL=wss://<your-backend-url>` (use `wss://` for production)

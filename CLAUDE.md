# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Clario** is an AI-powered public speaking practice tool. Users upload a script (PDF/DOCX/TXT), select a skill level, and practice sentence-by-sentence with demo narration, real-time acoustic analysis, automated scoring, and coaching feedback.

---

## Running the Project

### Backend (FastAPI, port 8000)

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**System dependency:** `ffmpeg` must be on PATH (used for audio format conversion: webm→WAV, MP3→PCM).

### Frontend (React + Vite, port 5173)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle → dist/
```

### Environment Variables

- `backend/.env` — copy from `backend/.env.example`. Requires: `GROQ_API_KEY`, `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY`
- `frontend/.env` — `VITE_BACKEND_URL=http://localhost:8000` and `VITE_BACKEND_WS_URL=ws://localhost:8000`

---

## Architecture

### Data Flow (user journey)

```
Upload script → POST /api/upload
  └─ Groq LLM annotates sentences (hero words, target WPM, pause markers)
  └─ Returns session_id + sentences[]

Edit annotations → PATCH /api/session/{id}/annotation

Practice loop (per sentence):
  POST /api/tts/demo         → Gemini 3.1 Flash Live streams PCM audio (demo narration)
  POST /api/analyse          → AssemblyAI STT + librosa acoustic analysis
  POST /api/feedback         → Groq generates coaching text + scoring
  WS   /ws/coach/{session_id} → edge-tts streams coach voice as PCM chunks
  POST /api/session/{id}/advance → move to next sentence or trigger paragraph review

Final report → POST /api/session/{id}/report
```

### Session State

Sessions are **in-memory only** (Python dict in `backend/session_store.py`, keyed by UUID). No database, no auth, no persistence across backend restarts.

```python
{
  "skill_level": "intermediate",
  "sentences": [{ "text", "hero_words", "pauses", "target_wpm", "ssml" }, ...],
  "paragraphs": [[0, 1, 2], [3, 4]],   # sentence indices grouped by paragraph
  "scores": { 0: { "pacing": 85, ... }, ... },
  "needs_review": [2, 5],               # sentence IDs that auto-advanced on 3rd retry
  "current_sentence_id": 3,
}
```

### Frontend Routing

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `Onboarding.jsx` | File upload + skill level |
| `/review/:sessionId` | `AnnotationReview.jsx` | Edit AI-generated annotations |
| `/session/:sessionId` | `SessionView.jsx` | Main practice orchestrator |
| `/report/:sessionId` | `SessionReport.jsx` | Final session summary |

`SessionView.jsx` is the most complex component — it owns the practice loop state, manages WebSocket for coach audio, orchestrates recording, analysis, feedback, and all child panels.

### Backend Routers

| File | Routes | Purpose |
|------|--------|---------|
| `routers/upload.py` | `POST /api/upload` | Parse file, call Groq for annotation |
| `routers/session.py` | `GET/PATCH /api/session/{id}` | Session state management |
| `routers/analyse.py` | `POST /api/analyse` | STT (AssemblyAI) + librosa pitch/intensity/pauses |
| `routers/feedback.py` | `POST /api/feedback` | Score calculation + Groq coaching text |
| `routers/tts.py` | `POST /api/tts/demo` | Gemini 3.1 Flash Live → PCM stream |
| `routers/live_coach.py` | `WS /ws/coach/{id}` | edge-tts → MP3 → PCM chunks |

---

## Key Implementation Details

### Audio Pipeline

1. Browser `MediaRecorder` → `audio/webm` blob
2. Backend: `ffmpeg` converts webm → WAV 16kHz mono
3. AssemblyAI `universal-2` → transcript + per-word millisecond timestamps
4. `librosa.pyin` → F0 pitch per word; `librosa` RMS → dB intensity per word
5. Gaps > 350ms between word timestamps → detected pauses

### Scoring Algorithm

```python
score_pacing(actual_wpm, target_wpm)      # 100 - (abs_deviation * 100)
score_fillers(filler_words_found)         # 100 - (count * 20), min 0
score_pauses(detected, annotated)         # % of annotated pauses matched
score_emphasis(word_pitch, hero_indices)  # % of hero words with ≥1.2× mean pitch/intensity
```

Advancement thresholds by skill level — all four dimensions must pass:

| Dimension | Beginner | Intermediate | Advanced |
|-----------|----------|--------------|----------|
| Pacing | ≥60 | ≥75 | ≥85 |
| Fillers | ≥60 | ≥80 | ≥100 |
| Pauses | ≥50 | ≥65 | ≥80 |
| Emphasis | N/A | ≥60 | ≥75 |

Max 3 attempts per sentence; auto-advance on 3rd failure (sentence added to `needs_review`).

### Two TTS Systems

- **Demo narration** (`routers/tts.py`): Gemini 3.1 Flash Live API, takes SSML with emphasis/breaks, streams raw PCM 24kHz
- **Coach voice** (`routers/live_coach.py`): `edge-tts` (Microsoft, NeerjaExpressiveNeural), converts MP3 → PCM 24kHz via ffmpeg, streams over WebSocket as base64 chunks

### LLMs Used

- **Groq `llama-3.3-70b-versatile`**: Both annotation (on upload) and per-attempt coaching feedback
- **Gemini 3.1 Flash Live** (`gemini-3.1-flash-live-preview`): Demo TTS only

### Rate Limiting

`main.py` has a `RateLimiter` class with an async lock shared across routers — primarily guards Groq (25 calls/min). Groq is called once per upload and once per feedback request.

### WebSocket Coach Audio Playback

`SessionView.jsx` uses `audioCtxRef` and `nextStartTimeRef` to schedule Web Audio API `AudioBufferSourceNode` from PCM chunks arriving over the WebSocket — enables gapless continuous playback.

---

## CORS

Backend allows: `http://localhost:5173`, `http://localhost:5174`

If running frontend on a different port, update `main.py` `origins` list.

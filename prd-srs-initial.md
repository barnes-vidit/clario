# Clario — Last-Minute Public Speaking Prep Tool

## What It Is

Clario is a web app that turns any script into a personalised, sentence-by-sentence speaking practice session. Upload your speech, pitch deck notes, or presentation script hours before you're on stage — Clario coaches you through it skill by skill: demonstrating ideal delivery, analysing your actual attempt acoustically, scoring you on measurable dimensions, and advancing only when you've genuinely improved. It's not a recording analyser. It's a drill partner.

---

## Tech Stack

| Layer | Tool | Free Tier |
|---|---|---|
| Frontend | React + Vite + TailwindCSS | Free |
| Backend | FastAPI (Python) | Free (run locally) |
| STT | AssemblyAI Universal-3 | $50 non-expiring credit, no card |
| Acoustic Analysis | librosa (Python, open source) | Free forever |
| Script Annotation LLM | Gemini 2.5 Flash (Google AI Studio) | 10 RPM, 250 RPD free |
| Per-attempt Feedback LLM | Cerebras — llama3.1-70b | 1M tokens/day, 30 RPM, no card |
| TTS Demo Voice | Google Cloud TTS — Chirp 3 HD | 1M Neural2 + 4M Standard chars/month free |
| Coach Voice | Gemini 3.1 Flash Live API | Free on dashboard (preview) |
| File Parsing | python-docx + PyMuPDF | Free (open source) |
| Audio Recording | MediaRecorder API (browser built-in) | Free |

---

## Environment Variables

### `/backend/.env`
```
ASSEMBLYAI_API_KEY=your_assemblyai_key
CEREBRAS_API_KEY=your_cerebras_key
GEMINI_API_KEY=your_google_ai_studio_key
GOOGLE_APPLICATION_CREDENTIALS=path/to/gcp_service_account.json
```

### `/frontend/.env`
```
VITE_BACKEND_URL=http://localhost:8000
```

---

## API Keys Setup (All Free)

1. **AssemblyAI** — https://www.assemblyai.com — Sign up, copy API key from dashboard. $50 credit, no card required, credits never expire.

2. **Cerebras** — https://cloud.cerebras.ai — Sign up, create an API key. 1M tokens/day, 30 RPM free, no card. Check your dashboard and confirm `llama3.1-70b` is listed as an available model (Cerebras rotates models; if deprecated, use the next available 70B-class model).

3. **Google AI Studio (Gemini)** — https://aistudio.google.com — Sign in with Google, create an API key. Works for both Gemini 2.5 Flash (annotation) and Gemini 3.1 Flash Live (coach voice).

4. **Google Cloud TTS** — https://console.cloud.google.com:
   - Create a new project
   - Enable the "Cloud Text-to-Speech API"
   - Go to IAM → Service Accounts → Create Service Account
   - Grant it "Cloud Text-to-Speech User" role
   - Download the JSON key file
   - Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of that file

---

## Project Structure

```
clario/
├── backend/
│   ├── main.py                    # FastAPI app, CORS config, router registration
│   ├── requirements.txt
│   ├── .env
│   ├── session_store.py           # In-memory session state (dict keyed by session_id)
│   └── routers/
│       ├── upload.py              # POST /api/upload — parse file + trigger Gemini annotation
│       ├── session.py             # GET /api/session/{id} — return session state
│       ├── analyse.py             # POST /api/analyse — STT + librosa acoustic analysis
│       ├── feedback.py            # POST /api/feedback — scoring + Cerebras coaching text
│       ├── tts.py                 # POST /api/tts/demo — Google Cloud TTS demo MP3
│       └── live_coach.py          # WebSocket /ws/coach/{session_id} — Gemini Live proxy
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── .env
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                # Router: Onboarding → AnnotationReview → Session → Report
│       └── components/
│           ├── Onboarding.jsx          # File upload + skill level selection
│           ├── AnnotationReview.jsx    # Editable annotated script preview
│           ├── SessionView.jsx         # Master session orchestrator
│           ├── ScriptPanel.jsx         # Script viewer with live sentence highlighting
│           ├── RecordButton.jsx        # Mic recording with live timer
│           ├── ScoreCard.jsx           # Per-dimension score display
│           ├── WaveformVisualiser.jsx  # Pitch/intensity bar chart with markers
│           ├── ParagraphReport.jsx     # Post-paragraph retention report
│           └── SessionReport.jsx       # Full end-of-session summary
└── README.md
```

---

## Full User Flow

### Step 1 — Onboarding (`Onboarding.jsx`)

- Drag-and-drop or click-to-upload area (accepts `.txt`, `.docx`, `.pdf`)
- Maximum file size: 5MB. Reject larger files with a clear error.
- Three skill level cards with descriptions:
  - **Beginner** — "Learning the basics. Relaxed thresholds, maximum encouragement."
  - **Intermediate** — "Polishing your delivery. Tighter standards, specific feedback."
  - **Advanced** — "Performance-ready. Near-professional standards expected."
- On submit: POST to `/api/upload` with file + skill level. Show loading state: "Analysing your script with AI…"
- On success: navigate to `/review/{session_id}`

---

### Step 2 — Script Annotation (backend, one Gemini call)

**Route:** `POST /api/upload`

Parse the file using `python-docx` (for `.docx`) or `PyMuPDF` (for `.pdf`) or plain read (for `.txt`).

Split into paragraphs on double newlines `\n\n`. Split each paragraph into sentences using a simple regex (split on `. `, `! `, `? ` while preserving punctuation).

Send the full extracted text to Gemini 2.5 Flash:

```python
import google.generativeai as genai

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-2.5-flash")

prompt = f"""You are a professional speech coach. Analyse the following script and return ONLY a valid JSON array — no markdown, no explanation, no code fences.

Each element represents one sentence and must have this exact shape:
{{
  "sentence_id": <integer, 0-indexed>,
  "paragraph_id": <integer, 0-indexed>,
  "text": "<sentence text>",
  "target_wpm": <integer — ideal speaking pace for this sentence, e.g. 110-150>,
  "pause_markers": [
    {{
      "after_word_index": <0-indexed word position>,
      "pause_type": "breath" | "impact" | "transition",
      "min_duration_ms": <integer>,
      "max_duration_ms": <integer>
    }}
  ],
  "hero_words": [<0-indexed word positions to emphasise>],
  "ssml_demo": "<full SSML string for this sentence with emphasis and break tags>"
}}

The ssml_demo must be a complete SSML string wrapped in <speak> tags, ready to send directly to Google Cloud TTS. Use <emphasis level='strong'> for hero words and <break time='Xms'/> for pauses. Example:
<speak>We must <emphasis level='strong'>never</emphasis> forget <break time='800ms'/> what happened here.</speak>

Script to analyse:
\"\"\"
{script_text}
\"\"\"
"""

response = model.generate_content(prompt)
annotation = json.loads(response.text)  # parse and validate
```

Store the annotation list in `session_store` keyed by `session_id` (UUID). Return `session_id` + annotation to the frontend.

---

### Step 3 — Annotation Review (`AnnotationReview.jsx`)

Display the annotated script with:
- **Hero words**: highlighted in amber/orange with underline
- **Pause markers**: rendered as `|` icon between words with a tooltip (pause type + duration range)
- **Target WPM badge**: small grey badge at the end of each sentence
- User can tap a hero word to toggle it off; tap a pause marker to remove it
- Edits are stored in local component state and sent back to the server via `PATCH /api/session/{id}/annotation` before starting
- "I'm ready — start practice" button → navigate to `/session/{session_id}`

---

### Step 4 — Practice Session (`SessionView.jsx`)

Layout:
- Left/top: `ScriptPanel` (full script, live highlighting)
- Right/bottom: coaching area (demo player, record button, score card, waveform, coach voice)

The session loop per sentence:

#### 4a. AI Demo Plays Automatically

On sentence load:
- Fetch MP3 from `POST /api/tts/demo` with `{ sentence_id, session_id }`
- Auto-play audio via `<audio>` element
- "Play again" button for user to replay demo
- ScriptPanel highlights the current sentence while demo plays

#### 4b. User Records

- RecordButton becomes active after demo plays
- `MediaRecorder` API records from microphone
- Accept `audio/webm` (Chrome default) — backend converts to WAV
- Show live recording timer (mm:ss)
- On stop: send audio blob to `POST /api/analyse`

#### 4c. Backend Analysis (`POST /api/analyse`)

Receives: audio blob (multipart), `session_id`, `sentence_id`

```python
import tempfile, soundfile as sf, librosa, numpy as np
import assemblyai as aai

FILLER_WORDS = {"um", "uh", "like", "basically", "you know", "so", "right", "okay"}
FMIN = 75    # Hz — minimum human voice F0
FMAX = 400   # Hz — maximum human voice F0

async def analyse_audio(audio_bytes: bytes, hero_words: list[str], session_id: str, sentence_id: int):

    # --- Convert to WAV if needed ---
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_in:
        tmp_in.write(audio_bytes)
        tmp_in_path = tmp_in.name

    tmp_wav_path = tmp_in_path.replace(".webm", ".wav")
    # Convert using ffmpeg subprocess:
    subprocess.run(["ffmpeg", "-i", tmp_in_path, "-ar", "16000", "-ac", "1", tmp_wav_path], check=True)

    # --- AssemblyAI STT ---
    annotation = session_store[session_id]["sentences"][sentence_id]
    hero_word_texts = [annotation["text"].split()[i] for i in annotation["hero_words"] if i < len(annotation["text"].split())]

    aai.settings.api_key = ASSEMBLYAI_API_KEY
    config = aai.TranscriptionConfig(
        word_boost=hero_word_texts,
        boost_param="high",
        disfluencies=True,
        punctuate=True,
        format_text=True,
    )
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(tmp_wav_path, config=config)

    words = [{"text": w.text, "start": w.start, "end": w.end} for w in transcript.words]
    filler_words_found = [w["text"] for w in words if w["text"].lower().strip(".,!?") in FILLER_WORDS]

    # --- librosa Acoustic Analysis ---
    y, sr = librosa.load(tmp_wav_path, sr=16000)
    duration_s = librosa.get_duration(y=y, sr=sr)

    # Use pYIN (NOT piptrack) — significantly more accurate for speech F0
    f0, voiced_flag, voiced_probs = librosa.pyin(y, fmin=FMIN, fmax=FMAX, sr=sr)
    f0_times = librosa.times_like(f0, sr=sr)

    rms = librosa.feature.rms(y=y)[0]
    rms_times = librosa.times_like(rms, sr=sr)

    word_pitch, word_intensity = [], []
    for word in words:
        start_s, end_s = word["start"] / 1000, word["end"] / 1000

        # Pitch per word
        mask = (f0_times >= start_s) & (f0_times <= end_s)
        f0_slice = f0[mask]
        voiced = f0_slice[~np.isnan(f0_slice)]
        mean_pitch = float(np.mean(voiced)) if len(voiced) > 0 else 0.0
        word_pitch.append(mean_pitch)

        # Intensity per word
        rms_mask = (rms_times >= start_s) & (rms_times <= end_s)
        mean_rms = float(np.mean(rms[rms_mask])) if rms_mask.any() else 0.0
        word_intensity.append(float(librosa.amplitude_to_db(np.array([mean_rms]))[0]))

    # Pause detection — gaps between words > 200ms
    pauses = []
    for i in range(1, len(words)):
        gap_ms = words[i]["start"] - words[i - 1]["end"]
        if gap_ms > 200:
            pauses.append({"after_word_index": i - 1, "duration_ms": int(gap_ms)})

    wpm = (len(words) / duration_s) * 60 if duration_s > 0 else 0

    # Cleanup temp files
    os.unlink(tmp_in_path)
    os.unlink(tmp_wav_path)

    return {
        "transcript": transcript.text,
        "words": words,
        "wpm": round(wpm, 1),
        "filler_words_found": filler_words_found,
        "pauses": pauses,
        "word_pitch": word_pitch,
        "word_intensity": word_intensity,
        "duration_s": round(duration_s, 2),
    }
```

#### 4d. Scoring (`POST /api/feedback`)

```python
def score_pacing(actual_wpm: float, target_wpm: int) -> int:
    deviation = abs(actual_wpm - target_wpm) / target_wpm
    return max(0, int(100 - deviation * 100))

def score_fillers(filler_words_found: list) -> int:
    return max(0, 100 - len(filler_words_found) * 20)

def score_pauses(detected_pauses: list, annotated_markers: list) -> int:
    if not annotated_markers:
        return 100
    hits = 0
    for marker in annotated_markers:
        target_idx = marker["after_word_index"]
        for p in detected_pauses:
            if abs(p["after_word_index"] - target_idx) <= 1:
                if marker["min_duration_ms"] <= p["duration_ms"] <= marker["max_duration_ms"]:
                    hits += 1
                    break
    return int((hits / len(annotated_markers)) * 100)

def score_emphasis(word_pitch: list, word_intensity: list, hero_word_indices: list) -> int:
    if not hero_word_indices:
        return 100
    # Filter out unvoiced words (pitch == 0) from sentence mean
    voiced_pitches = [p for p in word_pitch if p > 0]
    sentence_mean_pitch = float(np.mean(voiced_pitches)) if voiced_pitches else 0
    sentence_mean_intensity = float(np.mean(word_intensity)) if word_intensity else 0

    hits = 0
    for idx in hero_word_indices:
        if idx >= len(word_pitch):
            continue
        pitch_ok = word_pitch[idx] >= sentence_mean_pitch * 1.2 if sentence_mean_pitch > 0 else False
        intensity_ok = word_intensity[idx] >= sentence_mean_intensity * 1.2 if sentence_mean_intensity != 0 else False
        if pitch_ok or intensity_ok:
            hits += 1
    return int((hits / len(hero_word_indices)) * 100)
```

**Advancement thresholds by skill level:**

| Dimension | Beginner | Intermediate | Advanced |
|---|---|---|---|
| Pacing | ≥ 60 | ≥ 75 | ≥ 85 |
| Filler words | ≥ 60 | ≥ 80 | ≥ 100 |
| Pauses | ≥ 50 | ≥ 65 | ≥ 80 |
| Hero emphasis | N/A (always pass) | ≥ 60 | ≥ 75 |

All dimensions must meet their threshold to advance. Max 3 retries. After 3 failures: auto-advance, add `sentence_id` to session's `needs_review` list.

#### 4e. Coaching Text (Cerebras)

```python
from cerebras.cloud.sdk import Cerebras

cerebras_client = Cerebras(api_key=CEREBRAS_API_KEY)

def get_coaching_text(sentence: str, skill_level: str, scores: dict,
                       fillers: list, passed: bool, retry_num: int, auto_advanced: bool) -> str:
    status = "auto-advanced after 3 tries" if auto_advanced else ("passed" if passed else f"retry {retry_num} of 3")
    lowest = min(scores, key=scores.get)

    prompt = f"""Sentence attempted: "{sentence}"
Skill level: {skill_level}
Scores: pacing={scores['pacing']}/100, fillers={scores['filler_words']}/100, pauses={scores['pauses']}/100, emphasis={scores['hero_word_emphasis']}/100
Filler words detected: {fillers if fillers else 'none'}
Status: {status}
Lowest scoring area: {lowest}

Give 2–3 sentences of coaching. If passed: celebrate warmly, preview what comes next. If not passed: give one concrete, actionable tip on the lowest area only. Never be harsh."""

    response = cerebras_client.chat.completions.create(
        model="llama3.1-70b",
        messages=[
            {"role": "system", "content": "You are Clario, a warm and expert speaking coach helping someone prepare for a presentation. Be encouraging, specific, and brief."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=150,
    )
    return response.choices[0].message.content
```

#### 4f. Coach Voice Delivery — Gemini 3.1 Flash Live (Correct Implementation)

The frontend connects to the backend WebSocket proxy at `/ws/coach/{session_id}`.

The backend proxy opens a Gemini Live session using the **Google GenAI SDK** (`google-genai` package), which is the recommended approach per official docs.

**Backend WebSocket proxy** (`live_coach.py`):

```python
import asyncio
from google import genai
from google.genai import types
from fastapi import WebSocket

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY)

MODEL = "gemini-3.1-flash-live-preview"

async def coach_voice_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()

    config = {
        "response_modalities": ["AUDIO"],
        "speech_config": {
            "voice_config": {
                "prebuilt_voice_config": {
                    "voice_name": "Aoede"  # warm, natural voice
                }
            }
        },
        "system_instruction": {
            "parts": [{"text": "You are Clario, an encouraging public speaking coach. Speak naturally and warmly. Keep responses short — 2 to 3 sentences maximum."}]
        }
    }

    try:
        async with client.aio.live.connect(model=MODEL, config=config) as gemini_session:
            # Listen for text from frontend, speak it via Gemini Live
            while True:
                # Receive coaching text from frontend
                data = await websocket.receive_text()
                message = json.loads(data)

                if message["type"] == "speak":
                    coaching_text = message["text"]

                    # Send text to Gemini Live — it will respond with audio
                    await gemini_session.send_realtime_input(text=coaching_text)

                    # Collect and stream audio chunks back to frontend
                    async for response in gemini_session.receive():
                        if response.data:
                            # response.data is raw PCM 24kHz audio bytes
                            # Send as base64 to frontend
                            audio_b64 = base64.b64encode(response.data).decode()
                            await websocket.send_json({
                                "type": "audio_chunk",
                                "data": audio_b64,
                                "sample_rate": 24000
                            })
                        if response.server_content and response.server_content.turn_complete:
                            await websocket.send_json({"type": "turn_complete"})
                            break

                elif message["type"] == "close":
                    break

    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
    finally:
        await websocket.close()
```

**Frontend audio playback** (in `SessionView.jsx`):

```javascript
// Connect to coach WebSocket once per session
const coachWs = useRef(null);
const audioCtxRef = useRef(null);

useEffect(() => {
  coachWs.current = new WebSocket(`${import.meta.env.VITE_BACKEND_WS_URL}/ws/coach/${sessionId}`);
  audioCtxRef.current = new AudioContext({ sampleRate: 24000 });

  coachWs.current.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "audio_chunk") {
      // Decode base64 PCM and play via Web Audio API
      const raw = atob(msg.data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      // Convert PCM16 to Float32 for Web Audio
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      const buffer = audioCtxRef.current.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);
      const source = audioCtxRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtxRef.current.destination);
      source.start();
    }
  };

  return () => coachWs.current?.close();
}, [sessionId]);

// Called after scoring is complete:
function speakCoachFeedback(text) {
  coachWs.current?.send(JSON.stringify({ type: "speak", text }));
}
```

Add to frontend `.env`:
```
VITE_BACKEND_WS_URL=ws://localhost:8000
```

**Note on audio format:** Gemini Live outputs raw PCM 16-bit, 24kHz, little-endian, mono. The frontend must convert this to Float32 before playing via Web Audio API (shown above). Do not attempt to play PCM bytes directly via `<audio>` element — it won't work without a WAV header.

---

### Step 5 — Paragraph Review (`ParagraphReport.jsx`)

Triggered automatically after all sentences in a paragraph are completed.

- Prompt user: "Now say the whole paragraph without stopping."
- Record the full paragraph attempt as one audio blob
- Send to `/api/analyse` with `{ type: "paragraph", paragraph_id, session_id }`
- Score against the union of all sentence-level annotations for that paragraph
- Show "Retention Score" card:
  - How many sentence-level improvements carried over into the paragraph run
  - Per-dimension comparison: practiced vs paragraph attempt scores
  - Any regression flagged in amber

---

### Step 6 — Session Report (`SessionReport.jsx`)

Shown after all paragraphs are complete.

Displays:
- **Overall score radar chart** (Recharts `RadarChart`) — one axis per dimension
- **Score trend line** (Recharts `LineChart`) — score per sentence over time, per dimension
- **Needs review** — list of sentences that were auto-advanced after 3 failures, with a "Re-practice" button that restarts just those sentences
- **Top 3 takeaways** — generated by one final Cerebras call summarising the session
- **Download report** — export session data as JSON for future reference

---

## Google Cloud TTS — Demo Voice Implementation

```python
from google.cloud import texttospeech

tts_client = texttospeech.TextToSpeechClient()

def synthesise_demo(ssml_text: str) -> bytes:
    synthesis_input = texttospeech.SynthesisInput(ssml=ssml_text)
    voice = texttospeech.VoiceSelectionParams(
        language_code="en-US",
        name="en-US-Chirp3-HD-Aoede"
    )
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=1.0,
    )
    response = tts_client.synthesize_speech(
        input=synthesis_input, voice=voice, audio_config=audio_config
    )
    return response.audio_content  # MP3 bytes — serve as audio/mpeg
```

The MP3 is returned from `POST /api/tts/demo` and played directly via `<audio src={url} autoPlay />` in the frontend. This is standard browser audio, no PCM handling needed.

---

## FastAPI Backend — All Routes

```
POST   /api/upload                        Upload script + trigger annotation → returns session_id
GET    /api/session/{id}                  Return full session state (annotation, scores, current index)
PATCH  /api/session/{id}/annotation       Save user edits to annotation from AnnotationReview
POST   /api/analyse                       Receive audio, run STT + librosa → return analysis JSON
POST   /api/feedback                      Receive analysis + context → return scores + coaching text
POST   /api/tts/demo                      Return MP3 bytes for AI sentence demo (SSML → Chirp 3 HD)
POST   /api/session/{id}/advance          Advance to next sentence or trigger paragraph review
POST   /api/session/{id}/report           Return final session report data (scores, trends, needs_review)
WebSocket /ws/coach/{session_id}          Gemini 3.1 Flash Live proxy — speak coaching text as audio
```

---

## Frontend Component Behaviour (Detailed)

### `Onboarding.jsx`
- Dropzone (react-dropzone or native drag events) accepts `.txt`, `.docx`, `.pdf`, max 5MB
- Three clickable skill level cards with icons and short descriptions
- On submit: disable form, show spinner with "Clario is reading your script…"
- On API error: show inline error message, re-enable form

### `AnnotationReview.jsx`
- Renders annotated script sentence by sentence
- Hero words: `<span className="text-amber-500 underline font-semibold cursor-pointer">` — click to toggle off (strike-through + grey)
- Pause markers: rendered as `<span className="text-blue-400 mx-1">|</span>` with Tailwind tooltip on hover showing pause type and duration range — click to remove
- Target WPM: `<span className="ml-2 text-xs bg-gray-100 px-1 rounded">{wpm} wpm</span>`
- On "Start Practice": PATCH edited annotation to backend, then navigate to SessionView

### `SessionView.jsx`
- State: `currentSentenceId`, `retryCount` (0–3), `scores`, `isRecording`, `isProcessing`, `sessionPhase` ("sentence" | "paragraph_review" | "complete")
- Manages the full practice loop:
  1. Load sentence → auto-fetch and play TTS demo → show RecordButton
  2. On recording complete → POST to `/api/analyse` → POST to `/api/feedback` → show ScoreCard + WaveformVisualiser
  3. Speak coaching text via `speakCoachFeedback()` → WebSocket to Gemini Live
  4. If passed: `retryCount = 0`, advance to next sentence or paragraph review
  5. If failed and `retryCount < 3`: increment retry, show retry prompt
  6. If `retryCount === 3`: auto-advance, add to `needs_review`
  7. After last sentence of paragraph: enter paragraph review phase
  8. After all paragraphs: navigate to SessionReport

### `ScriptPanel.jsx`
- Renders all sentences as a scrollable list
- Active sentence: `bg-amber-50 border-l-4 border-amber-400 font-semibold`
- Completed + passed: `text-gray-400 line-through-none` with small green ✓
- Completed + needs_review: amber warning icon
- Auto-scrolls active sentence into view using `scrollIntoView({ behavior: 'smooth' })`
- Hero words and pause markers shown inline (read-only in session mode)

### `RecordButton.jsx`
- States: `idle` (grey mic), `recording` (red, pulsing ring animation), `processing` (spinner)
- Uses `navigator.mediaDevices.getUserMedia({ audio: true })`
- `MediaRecorder` with `mimeType: 'audio/webm'` (Chrome) or `'audio/ogg'` (Firefox)
- Collects chunks in array, assembles Blob on `dataavailable` + `stop`
- Shows recording duration as `mm:ss` counter
- Minimum recording duration: 1 second (reject shorter recordings with message "That was too short — try again")
- Maximum recording duration: 60 seconds (auto-stop)

### `ScoreCard.jsx`
- Four rows: Pacing, Filler Words, Pauses, Emphasis
- Each row: label + score number + animated progress bar
- Colour: `green` if ≥ threshold, `amber` if within 15 points below threshold, `red` if further below
- Shows the required threshold for current skill level in small grey text below bar
- Top banner: green "PASSED ✓" | amber "NEEDS WORK — try again" | grey "AUTO-ADVANCED"

### `WaveformVisualiser.jsx`
- Recharts `BarChart` of `word_intensity` values
- X-axis: word text labels
- Orange dot (`●`) above bars where hero words are
- Vertical dashed line (`|`) at annotated pause positions
- Solid blue line at detected actual pause positions
- Tooltip on hover: word text + pitch (Hz, rounded) + intensity (dB, rounded)
- If hero word pitch is 0 (unvoiced/whispered), show "—" instead of Hz value

### `ParagraphReport.jsx`
- Comparison table: sentence text | practiced score | paragraph score | delta (↑ green / ↓ red)
- Summary badge: "X/Y improvements held in paragraph run"
- "Continue to next paragraph" button

### `SessionReport.jsx`
- Recharts `RadarChart`: axes = Pacing, Filler Words, Pauses, Emphasis. Two polygons: first attempt average vs final attempt average.
- Recharts `LineChart`: x = sentence number, y = score per dimension, one line per dimension
- Needs Review list: sentence text + scores + "Re-practice" button
- AI Summary card: final Cerebras call with up to 3 key takeaways
- "Download Report (JSON)" button

---

## Rate Limit Management

```python
import asyncio, time

class RateLimiter:
    def __init__(self, calls_per_minute: int):
        self.interval = 60.0 / calls_per_minute
        self.last_call = 0.0
        self._lock = asyncio.Lock()

    async def wait(self):
        async with self._lock:
            now = time.monotonic()
            wait_time = self.interval - (now - self.last_call)
            if wait_time > 0:
                await asyncio.sleep(wait_time)
            self.last_call = time.monotonic()

# Instantiate in main.py and inject where needed
gemini_limiter = RateLimiter(calls_per_minute=8)    # safe under 10 RPM free limit
cerebras_limiter = RateLimiter(calls_per_minute=25)  # safe under 30 RPM free limit
```

---

## Python Dependencies (`backend/requirements.txt`)

```
fastapi
uvicorn[standard]
python-multipart
python-dotenv
assemblyai
librosa
numpy
scipy
soundfile
google-cloud-texttospeech
google-genai
cerebras-cloud-sdk
python-docx
pymupdf
httpx
websockets
```

> **Note:** The package for Gemini is `google-genai` (the new unified SDK), NOT `google-generativeai` (the old SDK). Use `from google import genai` in all backend files. Install with `pip install google-genai`.

---

## Frontend Dependencies (`package.json`)

```json
{
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "react-router-dom": "^6",
    "axios": "^1",
    "recharts": "^2",
    "tailwindcss": "^3",
    "@tailwindcss/typography": "^0",
    "lucide-react": "latest"
  },
  "devDependencies": {
    "vite": "^5",
    "@vitejs/plugin-react": "^4",
    "autoprefixer": "^10",
    "postcss": "^8"
  }
}
```

---

## FastAPI CORS Configuration (`main.py`)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Running Locally

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Make sure `ffmpeg` is installed on your system (used for audio conversion):
- macOS: `brew install ffmpeg`
- Ubuntu: `sudo apt install ffmpeg`
- Windows: download from https://ffmpeg.org/download.html, add to PATH

---

## Critical Implementation Notes

1. **Gemini SDK package name:** Use `google-genai` (new SDK). Import as `from google import genai`. Do NOT use `google-generativeai`.

2. **Gemini Live audio output format:** Raw PCM, 16-bit, little-endian, 24kHz mono. Must convert to Float32 in frontend before playing via Web Audio API. Cannot be played directly via `<audio>` element.

3. **Gemini Live text input method:** Use `session.send_realtime_input(text=coaching_text)` NOT `session.send_message()`. The `send_realtime_input` method is the correct API for Live sessions.

4. **Google Cloud TTS vs Gemini Live — two separate things:**
   - Google Cloud TTS (Chirp 3 HD): used for the AI demo voice. Takes SSML, returns MP3. Played via `<audio>` element.
   - Gemini 3.1 Flash Live: used for coach voice. Takes text via WebSocket, returns PCM audio stream. Played via Web Audio API.

5. **librosa pitch extraction:** Always use `librosa.pyin()`, never `librosa.piptrack()`. pYIN is probabilistic and far more accurate for speech fundamental frequency detection.

6. **AssemblyAI word timestamps:** `word.start` and `word.end` are in **milliseconds**. Divide by 1000 before using with librosa time arrays (which are in seconds).

7. **Audio format conversion:** MediaRecorder produces `audio/webm` in Chrome, `audio/ogg` in Firefox. The backend must convert both to WAV (16kHz mono) using ffmpeg via subprocess before passing to AssemblyAI and librosa.

8. **Gemini annotation call:** Make this one server-side call only — never re-annotate the same script twice. Cache result in `session_store`. Never expose the Gemini API key to the frontend.

9. **SSML validation:** After parsing Gemini's annotation JSON, validate each `ssml_demo` field is a string starting with `<speak>` and ending with `</speak>`. If malformed, fall back to plain text wrapped in `<speak>{sentence_text}</speak>`.

10. **Session store:** Python dict in memory, keyed by UUID. Structure per session:
    ```python
    session_store[session_id] = {
        "skill_level": str,
        "sentences": [annotation_dict, ...],   # list of annotated sentences
        "paragraphs": [[sentence_ids], ...],    # grouping
        "scores": {},                           # keyed by sentence_id
        "needs_review": [],                     # sentence_ids that auto-advanced
        "current_sentence_id": 0,
    }
    ```

11. **Emphasis scoring edge case:** If all `word_pitch` values for a sentence are 0 (e.g. user whispered), skip emphasis scoring entirely and return 100 with a note — don't penalise for whispering.

12. **Retry display:** Show the user clearly which retry they're on ("Attempt 2 of 3"). After auto-advance on 3rd failure, show: "We'll come back to this one. Moving on for now." in the ScoreCard banner.

13. **Paragraph detection from script:** Split on `\n\n`. If the script has no double newlines (e.g. a one-paragraph speech), treat the entire script as one paragraph.

14. **Cerebras model check:** On backend startup, log the model name being used. If `llama3.1-70b` returns a 404 or model-not-found error, fall back to the next available model shown in the Cerebras dashboard. Make the model name an env variable `CEREBRAS_MODEL=llama3.1-70b` so it's easy to swap.

15. **Frontend WebSocket URL:** Add `VITE_BACKEND_WS_URL=ws://localhost:8000` to `/frontend/.env`. Use this for the coach WebSocket connection, separate from the HTTP `VITE_BACKEND_URL`.

import asyncio
import logging
import os
import subprocess
import tempfile

import assemblyai as aai
import librosa
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from tenacity import retry, stop_after_attempt, wait_exponential

import session_store
from utils import find_ffmpeg

log = logging.getLogger("clario.analyse")
router = APIRouter()

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
FILLER_WORDS = {"um", "uh", "er", "hmm", "like", "basically", "you know"}
FMIN = 75
FMAX = 400
PAUSE_THRESHOLD_MS = 350
MAX_AUDIO_BYTES = 10 * 1024 * 1024


_FFMPEG = find_ffmpeg()
if _FFMPEG is None:
    log.warning("ffmpeg not found. Install imageio-ffmpeg (pip install imageio-ffmpeg) or add ffmpeg to PATH.")
else:
    log.info(f"ffmpeg: {_FFMPEG}")


def _convert_to_wav(audio_bytes: bytes, source_suffix: str) -> tuple[str, str]:
    if _FFMPEG is None:
        raise RuntimeError(
            "ffmpeg is not installed or not on PATH. "
            "Download it from https://ffmpeg.org/download.html and add to PATH."
        )
    with tempfile.NamedTemporaryFile(suffix=source_suffix, delete=False) as f:
        f.write(audio_bytes)
        tmp_in = f.name

    base, _ = os.path.splitext(tmp_in)
    tmp_wav = base + ".wav"
    result = subprocess.run(
        [_FFMPEG, "-y", "-i", tmp_in, "-ar", "16000", "-ac", "1", tmp_wav],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr[-500:]}")
    return tmp_in, tmp_wav


def _detect_suffix(content_type: str) -> str:
    if "ogg" in content_type:
        return ".ogg"
    if "mp4" in content_type or "m4a" in content_type:
        return ".mp4"
    return ".webm"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10), reraise=True)
def _transcribe(transcriber: aai.Transcriber, wav_path: str, config: aai.TranscriptionConfig) -> object:
    return transcriber.transcribe(wav_path, config)


async def _run_stt(wav_path: str, hero_word_texts: list[str]) -> object:
    aai.settings.api_key = ASSEMBLYAI_API_KEY
    aai.settings.http_timeout = 120  # default 30 s causes WriteTimeout on slow connections
    config_kwargs = dict(
        speech_models=[os.getenv("ASSEMBLYAI_MODEL", "universal-2")],
        disfluencies=True,
        punctuate=True,
        format_text=True,
    )
    if hero_word_texts:
        config_kwargs["word_boost"] = hero_word_texts
        config_kwargs["boost_param"] = aai.WordBoost.high
    config = aai.TranscriptionConfig(**config_kwargs)
    transcriber = aai.Transcriber()
    return await asyncio.to_thread(_transcribe, transcriber, wav_path, config)


def _acoustic_analysis(y: np.ndarray, sr: int, words: list[dict]) -> dict:
    duration_s = librosa.get_duration(y=y, sr=sr)

    f0, _, _ = librosa.pyin(y, fmin=FMIN, fmax=FMAX, sr=sr)
    f0_times = librosa.times_like(f0, sr=sr)
    rms = librosa.feature.rms(y=y)[0]
    rms_times = librosa.times_like(rms, sr=sr)

    word_pitch, word_intensity = [], []
    for word in words:
        start_s = word["start"] / 1000
        end_s = word["end"] / 1000

        pitch_mask = (f0_times >= start_s) & (f0_times <= end_s)
        f0_slice = f0[pitch_mask]
        voiced = f0_slice[~np.isnan(f0_slice)]
        word_pitch.append(float(np.mean(voiced)) if len(voiced) > 0 else 0.0)

        rms_mask = (rms_times >= start_s) & (rms_times <= end_s)
        mean_rms = float(np.mean(rms[rms_mask])) if rms_mask.any() else 0.0
        db = float(librosa.amplitude_to_db(np.array([mean_rms]))[0]) if mean_rms > 0 else -80.0
        word_intensity.append(db)

    # Real word-boundary gaps from AssemblyAI timestamps
    pauses = []
    for i in range(1, len(words)):
        gap_ms = words[i]["start"] - words[i - 1]["end"]
        if gap_ms > PAUSE_THRESHOLD_MS:
            pauses.append({"after_word_index": i - 1, "duration_ms": int(gap_ms)})

    # WPM from first-word-start → last-word-end (excludes leading/trailing silence)
    if len(words) >= 2:
        speech_duration_s = (words[-1]["end"] - words[0]["start"]) / 1000
        wpm = (len(words) / speech_duration_s) * 60 if speech_duration_s > 0 else 0.0
    else:
        wpm = 0.0

    return {
        "wpm": round(wpm, 1),
        "pauses": pauses,
        "word_pitch": word_pitch,
        "word_intensity": word_intensity,
        "duration_s": round(duration_s, 2),
    }


@router.post("/analyse")
async def analyse_audio(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    sentence_id: int = Form(None),
    type: str = Form("sentence"),
):
    data = session_store.get(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")

    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio file too large (max 10 MB).")

    content_type = audio.content_type or "audio/webm"
    suffix = _detect_suffix(content_type)
    sentences_map = data.get("sentences_map", {})

    tmp_in = None
    tmp_wav = None
    try:
        try:
            tmp_in, tmp_wav = _convert_to_wav(audio_bytes, suffix)
        except Exception as e:
            log.exception("Audio conversion failed")
            raise HTTPException(status_code=422, detail=f"Audio conversion failed: {e}")

        y, sr = librosa.load(tmp_wav, sr=16000)
        duration = librosa.get_duration(y=y, sr=sr)
        if duration < 0.5:
            raise HTTPException(status_code=400, detail="Recording too short (minimum 0.5 seconds).")
        if duration > 90:
            raise HTTPException(status_code=400, detail="Recording too long (maximum 90 seconds).")

        hero_word_texts: list[str] = []
        if type == "sentence" and sentence_id is not None:
            ann = sentences_map.get(sentence_id) or sentences_map.get(str(sentence_id))
            if ann:
                words_list = ann["text"].split()
                hero_word_texts = [
                    words_list[i] for i in ann.get("hero_words", []) if i < len(words_list)
                ]

        transcript = await _run_stt(tmp_wav, hero_word_texts)

        if transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=502, detail=f"STT error: {transcript.error}")

        all_words = [
            {"text": w.text, "start": w.start, "end": w.end}
            for w in (transcript.words or [])
        ]

        # Words that appear in the actual script must never be treated as fillers —
        # e.g. "like" in "I would like to speak" is a content word, not a filler.
        ann_for_filter = sentences_map.get(sentence_id) or sentences_map.get(str(sentence_id)) if sentence_id is not None else None
        script_words_lower: set[str] = (
            {w.lower().strip(".,!?") for w in (ann_for_filter["text"].split() if ann_for_filter else [])}
        )

        def _is_filler(word_text: str) -> bool:
            cleaned = word_text.lower().strip(".,!?")
            return cleaned in FILLER_WORDS and cleaned not in script_words_lower

        def _is_artifact(word_text: str) -> bool:
            # AssemblyAI with disfluencies=True sometimes emits single-char noise tokens
            # (e.g. "M.", "Mm.") for breath sounds or lip clicks. These are not filler words
            # the user said — they're transcription artifacts that must be silently discarded
            # so they don't shift hero_word and pause_marker indices.
            cleaned = word_text.lower().strip(".,!?")
            return len(cleaned) <= 1 and cleaned not in script_words_lower

        filler_words_found = [w["text"] for w in all_words if _is_filler(w["text"])]
        content_words = [w for w in all_words if not _is_filler(w["text"]) and not _is_artifact(w["text"])]

        acoustic = _acoustic_analysis(y, sr, content_words)

        return {
            "transcript": transcript.text,
            "words": content_words,
            "filler_words_found": filler_words_found,
            **acoustic,
        }

    except HTTPException:
        raise
    except Exception as e:
        log.exception("Analysis failed")
        raise HTTPException(status_code=502, detail=f"Analysis failed: {e}")
    finally:
        for p in (tmp_in, tmp_wav):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass

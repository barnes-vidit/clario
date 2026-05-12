import logging
import os

import assemblyai as aai
import librosa
import numpy as np
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from groq import AsyncGroq

import session_store
from routers.analyse import (
    FILLER_WORDS,
    _acoustic_analysis,
    _convert_to_wav,
    _detect_suffix,
    _run_stt,
)
from routers.feedback import score_emphasis, score_pauses, score_pacing
from utils import call_groq_with_retry

log = logging.getLogger("clario.fullscript")
router = APIRouter()

MAX_AUDIO_BYTES = 100 * 1024 * 1024  # 100 MB
MAX_DURATION_S = 600  # 10 minutes

_groq_client: AsyncGroq | None = None


def _get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        _groq_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    return _groq_client


def _align_words_to_sentences(content_words: list[dict], sentences: list[dict]) -> list[tuple[int, int]]:
    """
    Greedy sequential alignment: assign content_words to sentences based on expected
    word counts with ±40% tolerance. Returns (start_idx, end_idx) tuples into content_words.
    Scripted speech preserves word order, making this reliable for practice recordings.
    """
    if not content_words or not sentences:
        return [(0, 0)] * len(sentences)

    slices: list[tuple[int, int]] = []
    word_idx = 0
    total = len(content_words)

    for i, sentence in enumerate(sentences):
        if word_idx >= total:
            slices.append((total, total))
            continue

        # Last sentence gets all remaining words
        if i == len(sentences) - 1:
            slices.append((word_idx, total))
            break

        expected_count = len(sentence["text"].split())
        sentences_left = len(sentences) - i
        remaining = total - word_idx

        # Reserve at least 1 word per remaining sentence to avoid starving later ones
        max_take = max(1, remaining - (sentences_left - 1))
        min_take = max(1, int(expected_count * 0.6))
        take = min(max(min_take, expected_count), max_take)

        slices.append((word_idx, word_idx + take))
        word_idx += take

    while len(slices) < len(sentences):
        slices.append((total, total))

    return slices


def _score_sentence_slice(
    content_words: list[dict],
    word_pitch: list[float],
    word_intensity: list[float],
    all_pauses: list[dict],
    start_idx: int,
    end_idx: int,
    annotation: dict,
) -> dict:
    slice_words = content_words[start_idx:end_idx]
    expected_words = annotation["text"].split()
    covered = len(slice_words) >= max(1, len(expected_words) * 0.5)

    if not slice_words:
        return {
            "sentence_id": annotation["sentence_id"],
            "pacing": 0, "pauses": 0, "hero_word_emphasis": 0,
            "covered": False, "word_count": 0, "wpm": 0.0,
        }

    # WPM from slice timestamps only
    if len(slice_words) >= 2:
        speech_dur = (slice_words[-1]["end"] - slice_words[0]["start"]) / 1000
        wpm = (len(slice_words) / speech_dur) * 60 if speech_dur > 0 else 0.0
    else:
        wpm = 0.0

    # Re-index pauses to be sentence-local (after_word_index relative to slice start)
    local_pauses = [
        {"after_word_index": p["after_word_index"] - start_idx, "duration_ms": p["duration_ms"]}
        for p in all_pauses
        if start_idx <= p["after_word_index"] < end_idx
    ]

    slice_pitch = word_pitch[start_idx:end_idx]
    slice_intensity = word_intensity[start_idx:end_idx]
    hero_texts = [expected_words[i] for i in annotation.get("hero_words", []) if i < len(expected_words)]

    return {
        "sentence_id": annotation["sentence_id"],
        "pacing": score_pacing(wpm, annotation.get("target_wpm", 130)),
        "pauses": score_pauses(local_pauses, annotation.get("pause_markers", []), expected_words)["score"],
        "hero_word_emphasis": score_emphasis(
            slice_pitch, slice_intensity, annotation.get("hero_words", []), hero_texts
        )["score"],
        "covered": covered,
        "word_count": len(slice_words),
        "wpm": round(wpm, 1),
    }


def _compute_cumulative(sentence_scores: list[dict], total_fillers: int, total_words: int) -> dict:
    covered = [s for s in sentence_scores if s["covered"]]
    coverage = int(len(covered) / len(sentence_scores) * 100) if sentence_scores else 0

    def weighted_avg(key: str) -> int:
        total_w = sum(s["word_count"] for s in covered)
        if not total_w:
            return 0
        return int(sum(s[key] * s["word_count"] for s in covered) / total_w)

    # Global filler rate: penalise proportionally instead of the flat -20/filler formula
    filler_rate = total_fillers / max(total_words, 1)
    filler_score = max(0, int(100 - filler_rate * 500))

    # Pacing consistency: lower std dev across sentences = more consistent delivery
    wpms = [s["wpm"] for s in covered if s.get("wpm", 0) > 0]
    if len(wpms) >= 2:
        pacing_consistency = max(0, int(100 - float(np.std(wpms)) * 1.5))
    else:
        pacing_consistency = 100

    # Delivery arc: linear slope of pacing scores across sentences
    pacing_scores = [s["pacing"] for s in covered]
    arc = "stable"
    if len(pacing_scores) >= 3:
        slope = float(np.polyfit(np.arange(len(pacing_scores)), pacing_scores, 1)[0])
        if slope > 1.5:
            arc = "improving"
        elif slope < -1.5:
            arc = "declining"

    return {
        "pacing": weighted_avg("pacing"),
        "filler_words": filler_score,
        "pauses": weighted_avg("pauses"),
        "hero_word_emphasis": weighted_avg("hero_word_emphasis"),
        "pacing_consistency": pacing_consistency,
        "coverage": coverage,
        "arc": arc,
    }


async def _get_coaching(
    sentences: list[dict],
    sentence_scores: list[dict],
    overall: dict,
    skill_level: str,
    total_fillers: int,
    total_words: int,
) -> str:
    covered = [
        (i, sentences[i], sentence_scores[i])
        for i in range(min(len(sentences), len(sentence_scores)))
        if sentence_scores[i]["covered"]
    ]
    if not covered:
        return "Couldn't pick up enough of your delivery — make sure you're speaking clearly and close to the mic."

    def composite(sc: dict) -> float:
        return (sc["pacing"] + sc["pauses"] + sc["hero_word_emphasis"]) / 3

    best_i, best_s, best_sc = max(covered, key=lambda x: composite(x[2]))
    worst_i, worst_s, worst_sc = min(covered, key=lambda x: composite(x[2]))

    prompt = f"""Full script run — {skill_level} level
{total_words} words total, {total_fillers} filler words detected

Overall scores:
- Pacing: {overall['pacing']}/100 (consistency: {overall['pacing_consistency']}/100)
- Filler words: {overall['filler_words']}/100
- Pauses: {overall['pauses']}/100
- Emphasis: {overall['hero_word_emphasis']}/100
- Coverage: {overall['coverage']}% of sentences delivered
- Delivery arc: {overall['arc']}

Strongest moment (sentence {best_i + 1}): "{best_s['text'][:80]}"
  pacing={best_sc['pacing']}, pauses={best_sc['pauses']}, emphasis={best_sc['hero_word_emphasis']}

Weakest moment (sentence {worst_i + 1}): "{worst_s['text'][:80]}"
  pacing={worst_sc['pacing']}, pauses={worst_sc['pauses']}, emphasis={worst_sc['hero_word_emphasis']}

React like a friend who just watched them run the whole script in one take. Comment on the arc ({overall['arc']}). Highlight the best moment and give one specific fix for the weakest. 3–4 casual sentences, no formal coach language."""

    response = await call_groq_with_retry(
        _get_groq_client(),
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[
            {
                "role": "system",
                "content": (
                    "You are Clario, the user's straight-talking friend who just watched their full practice run. "
                    "Talk like a real person — casual, direct, genuine reactions. No corporate praise language."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        max_tokens=250,
        temperature=0.7,
    )
    return response.choices[0].message.content.strip()


@router.post("/session/{session_id}/fullscript")
async def analyse_fullscript(
    session_id: str,
    request: Request,
    audio: UploadFile = File(...),
):
    data = session_store.get(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")

    sentences = data.get("sentences", [])
    if not sentences:
        raise HTTPException(status_code=400, detail="Session has no sentences.")

    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio file too large (max 100 MB).")

    content_type = audio.content_type or "audio/webm"
    suffix = _detect_suffix(content_type)

    tmp_in = tmp_wav = None
    try:
        try:
            tmp_in, tmp_wav = _convert_to_wav(audio_bytes, suffix)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Audio conversion failed: {e}")

        y, sr = librosa.load(tmp_wav, sr=16000)
        duration = librosa.get_duration(y=y, sr=sr)
        if duration < 1.0:
            raise HTTPException(status_code=400, detail="Recording too short (minimum 1 second).")
        if duration > MAX_DURATION_S:
            raise HTTPException(
                status_code=400,
                detail=f"Recording too long (maximum {MAX_DURATION_S // 60} minutes).",
            )

        # Collect all hero word texts for STT boosting across the full script
        all_hero_texts: list[str] = []
        for ann in sentences:
            words_list = ann["text"].split()
            for i in ann.get("hero_words", []):
                if i < len(words_list):
                    all_hero_texts.append(words_list[i])

        transcript = await _run_stt(tmp_wav, list(set(all_hero_texts)))

        if transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=502, detail=f"STT error: {transcript.error}")

        raw_words = [
            {"text": w.text, "start": w.start, "end": w.end}
            for w in (transcript.words or [])
        ]

        # Build a unified script word set so content words (e.g. "like") are never
        # penalised as fillers just because they appear elsewhere in the script
        all_script_words: set[str] = {
            w.lower().strip(".,!?")
            for ann in sentences
            for w in ann["text"].split()
        }

        def _is_filler(text: str) -> bool:
            return text.lower().strip(".,!?") in FILLER_WORDS and text.lower().strip(".,!?") not in all_script_words

        def _is_artifact(text: str) -> bool:
            cleaned = text.lower().strip(".,!?")
            return len(cleaned) <= 1 and cleaned not in all_script_words

        filler_words_found = [w["text"] for w in raw_words if _is_filler(w["text"])]
        content_words = [w for w in raw_words if not _is_filler(w["text"]) and not _is_artifact(w["text"])]

        acoustic = _acoustic_analysis(y, sr, content_words)
        word_pitch: list[float] = acoustic["word_pitch"]
        word_intensity: list[float] = acoustic["word_intensity"]
        all_pauses: list[dict] = acoustic["pauses"]

        slices = _align_words_to_sentences(content_words, sentences)

        sentence_scores = [
            _score_sentence_slice(
                content_words, word_pitch, word_intensity, all_pauses,
                start_i, end_i, ann,
            )
            for ann, (start_i, end_i) in zip(sentences, slices)
        ]

        overall = _compute_cumulative(sentence_scores, len(filler_words_found), len(content_words))

        await request.app.state.groq_limiter.wait()
        try:
            coaching_text = await _get_coaching(
                sentences, sentence_scores, overall, data["skill_level"],
                len(filler_words_found), len(content_words),
            )
        except Exception as e:
            log.warning(f"Groq coaching failed: {e}")
            coaching_text = "Great full-script run! Check the breakdown below for where to focus next."

        result = {
            "transcript": transcript.text,
            "sentence_scores": sentence_scores,
            "overall": overall,
            "total_fillers": len(filler_words_found),
            "total_words": len(content_words),
            "total_duration_s": round(duration, 2),
            "coaching_text": coaching_text,
        }

        session_store.update(session_id, full_script_result=result)
        return result

    except HTTPException:
        raise
    except Exception as e:
        log.exception("Full-script analysis failed")
        raise HTTPException(status_code=502, detail=f"Analysis failed: {e}")
    finally:
        for p in (tmp_in, tmp_wav):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass

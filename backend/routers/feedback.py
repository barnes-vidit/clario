import logging
import os

import numpy as np
from fastapi import APIRouter, HTTPException
from groq import AsyncGroq
from pydantic import BaseModel

import session_store

log = logging.getLogger("clario.feedback")
router = APIRouter()

_groq_client: AsyncGroq | None = None


def _get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        _groq_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    return _groq_client

THRESHOLDS = {
    "beginner":     {"pacing": 60, "filler_words": 60, "pauses": 50, "hero_word_emphasis": None},
    "intermediate": {"pacing": 75, "filler_words": 80, "pauses": 65, "hero_word_emphasis": 60},
    "advanced":     {"pacing": 85, "filler_words": 100, "pauses": 80, "hero_word_emphasis": 75},
}


class FeedbackRequest(BaseModel):
    session_id: str
    sentence_id: int
    retry_num: int = 0
    transcript: str
    words: list[dict]
    wpm: float
    filler_words_found: list[str]
    pauses: list[dict]
    word_pitch: list[float]
    word_intensity: list[float]
    duration_s: float


# --- Scoring functions ---

def score_pacing(actual_wpm: float, target_wpm: int) -> int:
    if target_wpm == 0:
        return 100
    deviation = abs(actual_wpm - target_wpm) / target_wpm
    return max(0, int(100 - deviation * 100))


def score_fillers(filler_words_found: list) -> int:
    return max(0, 100 - len(filler_words_found) * 20)


def score_pauses(detected_pauses: list, annotated_markers: list, sentence_words: list[str] | None = None) -> dict:
    if not annotated_markers:
        return {"score": 100, "matched": [], "missed": []}
    total = 0
    matched: list[str] = []
    missed: list[str] = []
    for marker in annotated_markers:
        target_idx = marker["after_word_index"]
        min_d = marker["min_duration_ms"]
        max_d = marker["max_duration_ms"]
        label = (
            f"after '{sentence_words[target_idx]}'"
            if sentence_words and target_idx < len(sentence_words)
            else f"pause at word {target_idx}"
        )
        best = 0
        for p in detected_pauses:
            word_dist = abs(p["after_word_index"] - target_idx)
            if word_dist > 2:
                continue
            position_score = max(0, 100 - word_dist * 30)
            dur = p["duration_ms"]
            if min_d <= dur <= max_d:
                duration_score = 100
            elif dur < min_d:
                duration_score = max(0, int(100 * dur / min_d))
            else:
                duration_score = max(0, int(100 - (dur - max_d) / max(max_d, 1) * 50))
            best = max(best, (position_score + duration_score) // 2)
        total += best
        (matched if best >= 50 else missed).append(label)
    return {"score": int(total / len(annotated_markers)), "matched": matched, "missed": missed}


def score_emphasis(word_pitch: list, word_intensity: list, hero_word_indices: list,
                   hero_word_texts: list[str] | None = None) -> dict:
    if not hero_word_indices:
        return {"score": 100, "hits": [], "misses": []}
    if all(p == 0 for p in word_pitch):
        return {"score": 100, "hits": [], "misses": []}
    voiced_pitches = [p for p in word_pitch if p > 0]
    sentence_mean_pitch = float(np.mean(voiced_pitches)) if voiced_pitches else 0
    # Exclude silent words (-80 dB floor) from mean so the baseline reflects actual speech
    audible_intensities = [v for v in word_intensity if v > -79]
    sentence_mean_intensity = float(np.mean(audible_intensities)) if audible_intensities else None

    hits: list[str] = []
    misses: list[str] = []
    for i, idx in enumerate(hero_word_indices):
        label = (
            hero_word_texts[i]
            if hero_word_texts and i < len(hero_word_texts)
            else f"word {idx}"
        )
        if idx >= len(word_pitch):
            misses.append(label)
            continue
        pitch_ok = word_pitch[idx] >= sentence_mean_pitch * 1.2 if sentence_mean_pitch > 0 else False
        intensity_ok = (
            word_intensity[idx] >= sentence_mean_intensity + 3
            if sentence_mean_intensity is not None else False
        )
        (hits if pitch_ok or intensity_ok else misses).append(label)
    score = int(len(hits) / len(hero_word_indices) * 100)
    return {"score": score, "hits": hits, "misses": misses}


_DIM_LABELS = {
    "pacing": "speaking pace (words per minute)",
    "filler_words": "filler words (um, uh, like, etc.)",
    "pauses": "strategic pauses",
    "hero_word_emphasis": "emphasis on key words",
}

async def _get_coaching_text(sentence: str, skill_level: str, scores: dict,
                             fillers: list, passed: bool, retry_num: int, auto_advanced: bool,
                             emphasis_detail: dict | None = None,
                             pause_detail: dict | None = None) -> str:
    if auto_advanced:
        status = "auto-advanced after 3 tries"
    elif passed:
        status = "passed"
    else:
        status = f"retry {retry_num} of 3"

    thresholds_for_level = THRESHOLDS[skill_level]
    scored_dims = {k: v for k, v in scores.items() if thresholds_for_level.get(k) is not None}
    lowest_key = min(scored_dims, key=scored_dims.get) if scored_dims else min(scores, key=scores.get)
    lowest_label = _DIM_LABELS.get(lowest_key, lowest_key)

    # Build grounded per-word detail lines so the model never has to guess
    detail_lines: list[str] = []
    if emphasis_detail:
        if emphasis_detail["hits"]:
            detail_lines.append(f"Emphasis nailed: {', '.join(repr(w) for w in emphasis_detail['hits'])}")
        if emphasis_detail["misses"]:
            detail_lines.append(f"Emphasis missed: {', '.join(repr(w) for w in emphasis_detail['misses'])}")
    if pause_detail:
        if pause_detail["matched"]:
            detail_lines.append(f"Pauses landed: {', '.join(pause_detail['matched'])}")
        if pause_detail["missed"]:
            detail_lines.append(f"Pauses missed: {', '.join(pause_detail['missed'])}")
    detail_block = ("\n" + "\n".join(detail_lines)) if detail_lines else ""

    prompt = f"""Sentence attempted: "{sentence}"
Skill level: {skill_level}
Scores: pacing={scores['pacing']}/100, filler words={scores['filler_words']}/100, pauses={scores['pauses']}/100, key-word emphasis={scores['hero_word_emphasis']}/100
Filler words detected: {fillers if fillers else 'none'}
Status: {status}
Weakest area: {lowest_label}{detail_block}

If STATUS IS PASSED: react like a friend who just heard them nail it — pick one specific thing that worked and say it plainly. End with a quick "let's go" for the next one.
If STATUS IS NOT PASSED: give one direct tip on the weakest area using the specific word or pause above — like you're telling a friend what to fix, not writing a report.
2–3 short sentences. Casual. No formal language."""

    response = await _get_groq_client().chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[
            {
                "role": "system",
                "content": (
                    "You are Clario, the user's straight-talking friend who happens to know public speaking well. "
                    "Talk exactly like a close friend would — casual, direct, zero corporate fluff. "
                    "No 'I'm so proud of you', no 'your confident tone', none of that formal coach language. "
                    "React like a real person: short punchy sentences, genuine reactions, real talk."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        max_tokens=200,
        temperature=0.7,
    )
    return response.choices[0].message.content.strip()


@router.post("/feedback")
async def get_feedback(body: FeedbackRequest):
    data = session_store.get(body.session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")

    skill_level = data["skill_level"]
    sentences_map = data.get("sentences_map", {})
    ann = sentences_map.get(body.sentence_id) or sentences_map.get(str(body.sentence_id))
    if not ann:
        raise HTTPException(status_code=404, detail="Sentence not found in session")

    words_list = ann["text"].split()
    hero_word_texts = [words_list[i] for i in ann.get("hero_words", []) if i < len(words_list)]

    pause_detail = score_pauses(body.pauses, ann.get("pause_markers", []), words_list)
    emphasis_detail = score_emphasis(body.word_pitch, body.word_intensity, ann.get("hero_words", []), hero_word_texts)

    scores = {
        "pacing": score_pacing(body.wpm, ann.get("target_wpm", 130)),
        "filler_words": score_fillers(body.filler_words_found),
        "pauses": pause_detail["score"],
        "hero_word_emphasis": emphasis_detail["score"],
    }

    thresholds = THRESHOLDS[skill_level]
    passed = all(
        scores[dim] >= thresh
        for dim, thresh in thresholds.items()
        if thresh is not None
    )

    auto_advanced = not passed and body.retry_num >= 3
    if auto_advanced:
        needs_review = data.get("needs_review", [])
        if body.sentence_id not in needs_review:
            needs_review.append(body.sentence_id)
        session_store.update(body.session_id, needs_review=needs_review)

    # Update scores in session store
    session_scores = data.get("scores", {})
    sentence_key = str(body.sentence_id)
    if sentence_key not in session_scores:
        session_scores[sentence_key] = {"attempts": []}
    session_scores[sentence_key]["attempts"].append(scores)
    session_scores[sentence_key]["latest"] = scores
    session_scores[sentence_key]["passed"] = passed or auto_advanced
    session_store.update(body.session_id, scores=session_scores)

    try:
        coaching_text = await _get_coaching_text(
            sentence=ann["text"],
            skill_level=skill_level,
            scores=scores,
            fillers=body.filler_words_found,
            passed=passed,
            retry_num=body.retry_num,
            auto_advanced=auto_advanced,
            emphasis_detail=emphasis_detail,
            pause_detail=pause_detail,
        )
    except Exception as e:
        log.warning(f"Groq coaching text failed: {e}")
        if passed:
            coaching_text = "Well done! Keep that energy going into the next sentence."
        else:
            coaching_text = "Good effort — keep going! Focus on your weakest area and try again."

    return {
        "scores": scores,
        "thresholds": thresholds,
        "passed": passed,
        "auto_advanced": auto_advanced,
        "coaching_text": coaching_text,
        "sentence_text": ann["text"],
    }

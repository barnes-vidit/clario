import json
import logging
import os
import re
import uuid
from io import BytesIO

from groq import AsyncGroq
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Request

import session_store

log = logging.getLogger("clario.upload")
router = APIRouter()

_groq_client: AsyncGroq | None = None


def _get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        _groq_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    return _groq_client

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB

SYSTEM_PROMPT = """\
You are an expert public speaking coach trained in the techniques of TED speakers, Toastmasters, and executive communication coaches. \
Your job is to annotate a speaker's script so they can practise delivering it with professional-level vocal variety: \
the right pace, strategic pauses, and precise word emphasis. \
You understand that over-annotation kills impact — restraint is as important as emphasis. \
Return ONLY valid JSON — no markdown, no explanation, no code fences.\
"""

ANNOTATION_PROMPT = """\
Skill level of the speaker practising this script: {skill_level}

Annotate the script below and return ONLY a valid JSON array. Each element = one sentence.

━━━ SENTENCE SEGMENTATION ━━━
- Split on sentence-ending punctuation (. ! ?).
- Treat each bullet point or numbered list item as its own sentence.
- Headings / slide titles: include them as sentences (they are spoken aloud).
- Never merge two distinct thoughts into one sentence object.
- Assign paragraph_id by logical topic block (new paragraph in source = new paragraph_id). \
  Headings start a new paragraph.

━━━ FIELD RULES ━━━

target_wpm (integer):
  Choose the ideal speaking pace that serves the sentence's rhetorical purpose.
  Use these anchors:
    • Opening hook / closing call-to-action: 95-115 WPM  (slow = gravitas)
    • Dramatic statement, key insight, shocking statistic: 100-120 WPM
    • Normal narrative / explanation: 125-145 WPM
    • Energetic list, enthusiastic build-up: 150-165 WPM
    • Transition sentence ("Now let's look at…"): 115-130 WPM
  Skill-level adjustment — subtract from the above:
    beginner: −15 WPM  (they need extra time to recall words)
    intermediate: −5 WPM
    advanced: 0 WPM

pause_markers (array — may be empty):
  Place pauses only where they serve the delivery. Never add a pause just to fill time.
  Each pause object:
  {{
    "after_word_index": <0-indexed position of the word BEFORE the silence>,
    "pause_type": "breath" | "transition" | "impact" | "rhetorical",
    "min_duration_ms": <integer>,
    "max_duration_ms": <integer>
  }}

  Pause type definitions and typical durations:
    breath      — natural breathing point, mid-clause comma; 200–350 ms
    transition  — moving between sub-ideas within the sentence; 350–550 ms
    impact      — immediately BEFORE or AFTER the most important word/phrase; 550–900 ms
    rhetorical  — after a rhetorical question or a dramatic reveal; 800–1400 ms

  Placement rules:
    - breath: at natural comma positions or long prepositional phrases.
    - transition: when the sentence pivots ("not only… but also", "however").
    - impact: place ONE impact pause per sentence maximum — before the climax word/phrase.
    - rhetorical: only for sentences ending in "?" or sentences that invite audience reflection.
    - DO NOT add a pause at the very end of a sentence (end-of-sentence silence is implicit).
    - For short sentences (≤ 8 words), 0–1 pauses is usually correct.

hero_words (array of 0-indexed integers):
  The 1–3 words the speaker must vocally emphasise (higher pitch + louder) to land the sentence's key idea.
  Rules:
    - Maximum 3 hero words per sentence. Fewer is often better.
    - For short sentences (≤ 6 words), maximum 1–2 hero words.
    - Prefer: key nouns, strong action verbs, numbers/statistics, contrast markers \
(never, always, but, only, every), emotionally loaded adjectives.
    - Avoid: articles (a, the), prepositions, conjunctions, filler verbs (is, are, was).
    - Never mark a word as hero if you already placed an "impact" pause directly before it — \
the pause does the job; adding emphasis too is redundant overkill.

ssml_demo (string):
  A complete SSML string for Gemini TTS that EXACTLY matches hero_words and pause_markers.
  Rules:
    - Wrap in <speak>…</speak>.
    - Use <emphasis level='strong'> for hero words with 0-indexed position in hero_words.
    - Use <emphasis level='moderate'> for secondary emphasis if a word is important but not the peak.
    - Use <break time='Xms'/> for every pause in pause_markers (use the midpoint of min/max).
    - The word order and text inside <speak> must be verbatim from the "text" field — \
do not paraphrase, add, or remove words.
    - Every hero_word index and every pause after_word_index must appear exactly once in ssml_demo.

━━━ OUTPUT SHAPE ━━━

[
  {{
    "sentence_id": <integer, 0-indexed>,
    "paragraph_id": <integer, 0-indexed>,
    "text": "<exact sentence text>",
    "sentence_function": "hook" | "context" | "claim" | "evidence" | "transition" | "cta" | "other",
    "target_wpm": <integer>,
    "pause_markers": [
      {{
        "after_word_index": <integer>,
        "pause_type": "breath" | "transition" | "impact" | "rhetorical",
        "min_duration_ms": <integer>,
        "max_duration_ms": <integer>
      }}
    ],
    "hero_words": [<integers>],
    "ssml_demo": "<speak>…</speak>"
  }},
  …
]

━━━ QUALITY CHECKLIST (verify before outputting) ━━━
□ Every sentence has target_wpm within the correct skill-adjusted range for its function.
□ No sentence has more than 3 hero words; short sentences have ≤ 2.
□ No pause appears at the very last word of any sentence.
□ Impact pause count ≤ 1 per sentence.
□ ssml_demo contains <break> tags for every pause_marker and <emphasis> for every hero_word.
□ ssml_demo text content is verbatim — no paraphrasing.
□ Output is a JSON array only — no keys, no wrapper object.

Script to annotate (skill_level={skill_level}):
\"\"\"
{script_text}
\"\"\"
"""


def _extract_text(filename: str, content: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()

    if ext == "txt":
        return content.decode("utf-8", errors="replace")

    if ext == "docx":
        from docx import Document
        doc = Document(BytesIO(content))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())

    if ext == "pdf":
        import pymupdf
        doc = pymupdf.open(stream=content, filetype="pdf")
        pages = []
        for page in doc:
            pages.append(page.get_text())
        return "\n\n".join(pages)

    raise HTTPException(status_code=400, detail=f"Unsupported file type: .{ext}")


def _build_paragraphs_index(sentences: list[dict]) -> list[list[int]]:
    index: dict[int, list[int]] = {}
    for s in sentences:
        index.setdefault(s["paragraph_id"], []).append(s["sentence_id"])
    return [index[k] for k in sorted(index.keys())]


def _validate_ssml(ssml: str, fallback_text: str) -> str:
    if isinstance(ssml, str) and ssml.strip().startswith("<speak>") and ssml.strip().endswith("</speak>"):
        return ssml
    return f"<speak>{fallback_text}</speak>"


async def _annotate_script(script_text: str, skill_level: str, limiter) -> list[dict]:
    await limiter.wait()
    prompt = ANNOTATION_PROMPT.format(script_text=script_text, skill_level=skill_level)

    response = await _get_groq_client().chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=8192,
    )

    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

    annotation = json.loads(raw)

    for item in annotation:
        item["ssml_demo"] = _validate_ssml(item.get("ssml_demo", ""), item.get("text", ""))

    return annotation


@router.post("/upload")
async def upload_script(
    request: Request,
    file: UploadFile = File(...),
    skill_level: str = Form(...),
):
    if skill_level not in ("beginner", "intermediate", "advanced"):
        raise HTTPException(status_code=400, detail="skill_level must be beginner, intermediate, or advanced")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 5MB limit")

    try:
        script_text = _extract_text(file.filename or "upload.txt", content)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("File parsing error")
        raise HTTPException(status_code=422, detail=f"Could not parse file: {e}")

    if not script_text.strip():
        raise HTTPException(status_code=422, detail="File appears to be empty")

    log.info(f"Annotating script — {len(script_text)} chars, skill_level={skill_level}")

    limiter = request.app.state.groq_limiter
    try:
        annotation = await _annotate_script(script_text, skill_level, limiter)
    except json.JSONDecodeError as e:
        log.error(f"Groq returned non-JSON: {e}")
        raise HTTPException(status_code=502, detail="AI annotation failed — invalid JSON response")
    except Exception as e:
        log.exception("Groq annotation error")
        raise HTTPException(status_code=502, detail=f"AI annotation failed: {e}")

    session_id = str(uuid.uuid4())
    sentences_map = {s["sentence_id"]: s for s in annotation}
    paragraphs = _build_paragraphs_index(annotation)

    session_store.set(session_id, {
        "skill_level": skill_level,
        "sentences": annotation,
        "sentences_map": sentences_map,
        "paragraphs": paragraphs,
        "scores": {},
        "needs_review": [],
        "current_sentence_id": 0,
    })

    log.info(f"Session created: {session_id} — {len(annotation)} sentences, {len(paragraphs)} paragraphs")

    return {
        "session_id": session_id,
        "annotation": annotation,
        "paragraphs": paragraphs,
        "skill_level": skill_level,
    }

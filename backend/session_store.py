from typing import Any

# In-memory store keyed by session UUID.
# Structure per entry:
# {
#   "skill_level": str,
#   "sentences": [annotation_dict, ...],
#   "paragraphs": [[sentence_ids], ...],
#   "scores": { sentence_id: { pacing, filler_words, pauses, hero_word_emphasis, passed, retry_count } },
#   "needs_review": [sentence_ids],
#   "current_sentence_id": int,
# }
_store: dict[str, dict[str, Any]] = {}


def get(session_id: str) -> dict | None:
    return _store.get(session_id)


def set(session_id: str, data: dict) -> None:
    _store[session_id] = data


def update(session_id: str, **kwargs) -> dict | None:
    if session_id not in _store:
        return None
    _store[session_id].update(kwargs)
    return _store[session_id]

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import session_store

log = logging.getLogger("clario.session")
router = APIRouter()


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    data = session_store.get(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")
    return data


class AnnotationPatch(BaseModel):
    sentences: list[dict]


@router.patch("/session/{session_id}/annotation")
async def patch_annotation(session_id: str, body: AnnotationPatch):
    async with session_store.get_lock(session_id):
        data = session_store.get(session_id)
        if not data:
            raise HTTPException(status_code=404, detail="Session not found")

        sentences_map = {s["sentence_id"]: s for s in body.sentences}
        session_store.update(
            session_id,
            sentences=body.sentences,
            sentences_map=sentences_map,
        )
    log.info(f"Annotation patched for session {session_id}")
    return {"ok": True}


@router.post("/session/{session_id}/advance")
async def advance_session(session_id: str):
    async with session_store.get_lock(session_id):
        data = session_store.get(session_id)
        if not data:
            raise HTTPException(status_code=404, detail="Session not found")

        current = data["current_sentence_id"]
        total = len(data["sentences"])

        if current + 1 >= total:
            session_store.update(session_id, current_sentence_id=total, complete=True)
            return {"status": "complete"}

        next_id = current + 1
        session_store.update(session_id, current_sentence_id=next_id)

        current_para = data["sentences"][current]["paragraph_id"]
        next_para = data["sentences"][next_id]["paragraph_id"]

    if next_para != current_para:
        return {"status": "paragraph_complete", "next_sentence_id": next_id, "completed_paragraph_id": current_para}

    return {"status": "next", "next_sentence_id": next_id}


@router.post("/session/{session_id}/report")
async def get_report(session_id: str):
    data = session_store.get(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "skill_level": data["skill_level"],
        "scores": data["scores"],
        "needs_review": data["needs_review"],
        "sentences": data["sentences"],
        "paragraphs": data["paragraphs"],
    }

import asyncio
import io
import logging
import os
import re
import wave

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from google import genai
from google.genai import types
from pydantic import BaseModel

import session_store

log = logging.getLogger("clario.tts")
router = APIRouter()

_genai_client: genai.Client | None = None


def _get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _genai_client


GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
DEMO_VOICE = "Aoede"  # lyrical, expressive — best for public speaking demo
_IDLE_TIMEOUT_S = float(os.getenv("TTS_IDLE_TIMEOUT_S", "90"))

_LIVE_CONFIG = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                voice_name=DEMO_VOICE,
            )
        )
    ),
    system_instruction=types.Content(
        parts=[types.Part(
            text=(
                "You are a professional public speaker. You give presentations/speeches for a living and are very good at it. "
                "Read aloud the content words of the text you receive, using the markup as prosody instructions:\n"
                "- <emphasis>word</emphasis>: speak that word with noticeably higher pitch and volume — do NOT say the tag names.\n"
                "- <pause>: take extended noticeable pause to create impact — do NOT say pause\n"
                "Apart from these two tags , you can use the natural, deliberate prosody of a skilled public speaker throughout. "
                "Do NOT add any words, greetings, commentary, or continuations before or after the text. "
                "Stop the instant the provided text ends."
            )
        )]
    ),
)


class TtsRequest(BaseModel):
    session_id: str
    sentence_id: int


def _ssml_to_gemini_text(ssml: str) -> str:
    """Convert SSML markup to Gemini Live-compatible inline markup."""
    text = re.sub(r"</?speak>", "", ssml).strip()
    text = re.sub(r"<emphasis[^>]*>", "<emphasis>", text)

    def _break_to_dots(m: re.Match) -> str:
        try:
            ms = int(m.group(1))
        except ValueError:
            return "...."
        if ms < 400:
            return "."
        if ms < 700:
            return ".."
        if ms < 1100:
            return "..."
        return "...."

    text = re.sub(r"<break\s+time=['\"](\d+)ms['\"]/>", _break_to_dots, text)
    text = re.sub(r"<(?!/?emphasis)[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


async def _do_synthesis(session, gemini_text: str) -> bytes:
    """Send one text turn on an already-open Live session and return WAV bytes."""
    pcm_chunks: list[bytes] = []
    await session.send_client_content(
        turns=types.Content(
            role="user",
            parts=[types.Part(text=gemini_text)],
        ),
        turn_complete=True,
    )
    async for message in session.receive():
        sc = message.server_content
        if sc is None:
            continue
        if sc.model_turn:
            for part in sc.model_turn.parts or []:
                if part.inline_data and part.inline_data.data:
                    pcm_chunks.append(part.inline_data.data)
        if sc.turn_complete:
            break
    if not pcm_chunks:
        raise RuntimeError("Gemini Live returned no audio data")
    return _pcm_to_wav(b"".join(pcm_chunks))


async def _live_worker(
    session_id: str,
    queue: asyncio.Queue,
    manager: "LiveSessionManager",
) -> None:
    log.info(f"[tts] opening Gemini Live connection — session {session_id}")
    try:
        async with _get_genai_client().aio.live.connect(
            model=GEMINI_LIVE_MODEL, config=_LIVE_CONFIG
        ) as session:
            while True:
                try:
                    text, future = await asyncio.wait_for(
                        queue.get(), timeout=_IDLE_TIMEOUT_S
                    )
                except asyncio.TimeoutError:
                    log.info(f"[tts] idle timeout — closing connection for session {session_id}")
                    break

                if future.cancelled():
                    continue

                try:
                    wav = await _do_synthesis(session, text)
                    future.set_result(wav)
                except Exception as e:
                    log.warning(f"[tts] synthesis error for session {session_id}: {e}")
                    if not future.done():
                        future.set_exception(e)
                    # Connection is likely broken — exit and let next request respawn
                    break

    except asyncio.CancelledError:
        raise
    except Exception as e:
        log.warning(f"[tts] worker crashed for session {session_id}: {e}")
    finally:
        manager._remove_worker(session_id)
        log.info(f"[tts] Gemini Live connection closed — session {session_id}")
        # Fail any requests that were queued behind the one that broke the connection
        while not queue.empty():
            try:
                _, pending_future = queue.get_nowait()
                if not pending_future.done():
                    pending_future.set_exception(
                        RuntimeError("TTS worker closed; please retry")
                    )
            except asyncio.QueueEmpty:
                break


class LiveSessionManager:
    def __init__(self) -> None:
        self._workers: dict[str, asyncio.Task] = {}
        self._queues: dict[str, asyncio.Queue] = {}

    def _remove_worker(self, session_id: str) -> None:
        self._workers.pop(session_id, None)
        self._queues.pop(session_id, None)

    def _ensure_worker(self, session_id: str) -> asyncio.Queue:
        task = self._workers.get(session_id)
        if task is None or task.done():
            queue: asyncio.Queue = asyncio.Queue()
            self._queues[session_id] = queue
            self._workers[session_id] = asyncio.create_task(
                _live_worker(session_id, queue, self),
                name=f"tts-worker-{session_id}",
            )
        return self._queues[session_id]

    async def synthesise(self, session_id: str, gemini_text: str) -> bytes:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[bytes] = loop.create_future()
        queue = self._ensure_worker(session_id)
        await queue.put((gemini_text, future))
        return await future

    async def close_session(self, session_id: str) -> None:
        task = self._workers.pop(session_id, None)
        self._queues.pop(session_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def close_all(self) -> None:
        for sid in list(self._workers.keys()):
            await self.close_session(sid)


live_session_manager = LiveSessionManager()


@router.post("/tts/demo")
async def tts_demo(body: TtsRequest):
    data = session_store.get(body.session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")

    sentences_map = data.get("sentences_map", {})
    ann = sentences_map.get(body.sentence_id) or sentences_map.get(str(body.sentence_id))
    if not ann:
        raise HTTPException(status_code=404, detail="Sentence not found")

    ssml = ann.get("ssml_demo", f"<speak>{ann['text']}</speak>")
    gemini_text = _ssml_to_gemini_text(ssml)
    log.debug(f"TTS input: {gemini_text[:120]}")

    try:
        wav_bytes = await live_session_manager.synthesise(body.session_id, gemini_text)
    except Exception as e:
        log.exception("Gemini Live TTS synthesis failed")
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")

    return Response(content=wav_bytes, media_type="audio/wav")

import asyncio
import base64
import json
import logging
import os
import subprocess
import tempfile

import edge_tts
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from utils import find_ffmpeg

log = logging.getLogger("clario.live_coach")
router = APIRouter()

# Indian English expressive female voice — warm and coach-like
COACH_VOICE = "en-IN-NeerjaExpressiveNeural"
PCM_CHUNK_SIZE = 4096  # bytes per audio chunk sent to frontend

_FFMPEG = find_ffmpeg()


async def _synthesise_pcm(text: str) -> bytes:
    """Generate edge-tts MP3, convert to PCM 24kHz mono for the frontend."""
    mp3_chunks = []
    communicate = edge_tts.Communicate(text, COACH_VOICE, rate="+20%")
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_chunks.append(chunk["data"])
    mp3_bytes = b"".join(mp3_chunks)

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(mp3_bytes)
        mp3_path = f.name

    try:
        result = subprocess.run(
            [_FFMPEG, "-i", mp3_path, "-ar", "24000", "-ac", "1", "-f", "s16le", "-"],
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg PCM conversion failed: {result.stderr[-300:]}")
        return result.stdout
    finally:
        os.unlink(mp3_path)


@router.websocket("/ws/coach/{session_id}")
async def coach_voice_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    log.info(f"Coach WebSocket connected — session {session_id}")

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=120.0)
            except asyncio.TimeoutError:
                log.info(f"Coach WebSocket idle timeout — session {session_id}")
                break

            message = json.loads(raw)

            if message["type"] == "speak":
                coaching_text = message["text"]
                log.debug(f"Coach speaking: {coaching_text[:80]}…")

                try:
                    pcm_bytes = await _synthesise_pcm(coaching_text)
                except Exception as e:
                    log.exception("Coach TTS failed")
                    await websocket.send_json({"type": "error", "message": str(e)})
                    continue

                # Stream PCM in chunks — same format frontend already handles
                for i in range(0, len(pcm_bytes), PCM_CHUNK_SIZE):
                    chunk = pcm_bytes[i:i + PCM_CHUNK_SIZE]
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "data": base64.b64encode(chunk).decode(),
                        "sample_rate": 24000,
                    })

                await websocket.send_json({"type": "turn_complete"})

            elif message["type"] == "close":
                break

    except WebSocketDisconnect:
        log.info(f"Coach WebSocket disconnected — session {session_id}")
    except Exception:
        log.exception(f"Coach WebSocket error — session {session_id}")
        try:
            await websocket.send_json({"type": "error", "message": "Coach error"})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
        log.info(f"Coach WebSocket closed — session {session_id}")

import asyncio
import logging
import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger("clario")

app = FastAPI(title="Clario", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Rate limiters (shared across routers) ---
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

groq_limiter = RateLimiter(calls_per_minute=25)

app.state.groq_limiter = groq_limiter

# --- Register routers ---
from routers import upload, session, analyse, feedback, tts, live_coach  # noqa: E402

app.include_router(upload.router, prefix="/api")
app.include_router(session.router, prefix="/api")
app.include_router(analyse.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(tts.router, prefix="/api")
app.include_router(live_coach.router)


@app.on_event("startup")
async def startup():
    required = ["GEMINI_API_KEY", "ASSEMBLYAI_API_KEY", "GROQ_API_KEY"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise RuntimeError(f"Missing required env vars: {missing}. Check your .env file.")

    log.info("Clario backend starting up")
    log.info(f"TTS model: {os.getenv('GEMINI_LIVE_MODEL', 'gemini-3.1-flash-live-preview')}")
    log.info(f"Annotation + feedback model: {os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')}")
    log.info(f"STT model: {os.getenv('ASSEMBLYAI_MODEL', 'universal-2')}")


@app.on_event("shutdown")
async def shutdown():
    await tts.live_session_manager.close_all()
    log.info("Clario backend shut down — all Gemini Live connections closed")


@app.get("/health")
async def health():
    return {"status": "ok"}

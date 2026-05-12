import shutil

from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential


def find_ffmpeg() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return None


async def call_groq_with_retry(client, **kwargs):
    async for attempt in AsyncRetrying(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    ):
        with attempt:
            return await client.chat.completions.create(**kwargs)

import asyncio
from collections.abc import Iterator

import aiohttp
import httpx

RATE_LIMIT_MESSAGE = "Превышен лимит запросов к Gemini API, попробуйте позже"
REGION_MESSAGE = "Gemini API недоступен из вашего региона. Укажите HTTPS_PROXY в .env или включите VPN"
INVALID_KEY_MESSAGE = "Неверный GOOGLE_API_KEY. Проверьте ключ в .env"
MODEL_NOT_FOUND_MESSAGE = "Модель не найдена. Проверьте CHAT_MODEL и EMBEDDING_MODEL в .env"
NETWORK_MESSAGE = "Нет связи с Gemini API. Проверьте сеть и HTTPS_PROXY"

# Connection and timeout failures of the transports used by google-genai (httpx, aiohttp).
_NETWORK_ERRORS: tuple[type[BaseException], ...] = (
    httpx.ConnectError,
    httpx.ProxyError,
    httpx.TimeoutException,
    aiohttp.ClientConnectionError,
    asyncio.TimeoutError,
)


def _chain(exc: BaseException | None) -> Iterator[BaseException]:
    """The exception and everything it was raised from or during (__cause__, then __context__), each once."""
    seen: set[int] = set()
    pending: list[BaseException] = [exc] if exc is not None else []
    while pending:
        current = pending.pop(0)
        if id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        pending.extend(e for e in (current.__cause__, current.__context__) if e is not None)


def _code(exc: BaseException) -> int | None:
    """HTTP status of a google-genai APIError (`code`) or of an HTTP-ish error (`status_code`)."""
    for attr in ("code", "status_code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _text(exc: BaseException) -> str:
    """Lower-cased message text: str() plus google-genai's `message` / `status` attributes."""
    parts = [str(exc)] + [str(v) for v in (getattr(exc, "message", None), getattr(exc, "status", None)) if v]
    return " ".join(parts).lower()


def classify_llm_error(exc: Exception) -> tuple[int, str]:
    """HTTP status and a short user-facing text for a Gemini failure (never includes a stack trace)."""
    chain = list(_chain(exc))
    codes = {c for c in map(_code, chain) if c is not None}
    text = " ".join(map(_text, chain))

    if 429 in codes:
        return 503, RATE_LIMIT_MESSAGE
    if "location is not supported" in text:
        return 502, REGION_MESSAGE
    if codes & {401, 403} or (400 in codes and "api key not valid" in text):
        return 502, INVALID_KEY_MESSAGE
    if 404 in codes:
        return 502, MODEL_NOT_FOUND_MESSAGE
    if any(isinstance(e, _NETWORK_ERRORS) for e in chain):
        return 502, NETWORK_MESSAGE
    return 502, f"Ошибка обращения к Gemini API: {type(exc).__name__}"

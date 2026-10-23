RATE_LIMIT_MESSAGE = "Превышен лимит запросов к Gemini API, попробуйте позже"


def _is_rate_limit(exc: BaseException | None) -> bool:
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if getattr(exc, "code", None) == 429 or getattr(exc, "status_code", None) == 429:
            return True
        exc = exc.__cause__
    return False


def classify_llm_error(exc: Exception) -> tuple[int, str]:
    """HTTP status and a short user-facing text for a Gemini failure (never includes a stack trace)."""
    if _is_rate_limit(exc):
        return 503, RATE_LIMIT_MESSAGE
    return 502, f"Ошибка обращения к Gemini API: {type(exc).__name__}"

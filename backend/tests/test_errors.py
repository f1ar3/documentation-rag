import asyncio

import aiohttp
import httpx
import pytest
from google.genai.errors import ClientError
from langchain_google_genai.chat_models import (
    GoogleAuthenticationError,
    GoogleInvalidRequestError,
    GoogleModelNotFoundError,
    GooglePermissionDeniedError,
)

from app.errors import (
    INVALID_KEY_MESSAGE,
    MODEL_NOT_FOUND_MESSAGE,
    NETWORK_MESSAGE,
    REGION_MESSAGE,
    classify_llm_error,
)


class WithCode(Exception):
    def __init__(self, code=None, status_code=None):
        super().__init__("boom with secret details")
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


def test_code_429_is_503():
    status, text = classify_llm_error(WithCode(code=429))
    assert status == 503
    assert text == "Превышен лимит запросов к Gemini API, попробуйте позже"


def test_status_code_429_is_503():
    assert classify_llm_error(WithCode(status_code=429))[0] == 503


def test_other_error_is_502_with_class_name_only():
    status, text = classify_llm_error(RuntimeError("secret trace"))
    assert status == 502
    assert text == "Ошибка обращения к Gemini API: RuntimeError"


def test_cause_chain_with_429_is_503():
    try:
        try:
            raise WithCode(status_code=429)
        except WithCode as inner:
            raise RuntimeError("wrapped") from inner
    except RuntimeError as exc:
        assert classify_llm_error(exc)[0] == 503


# --- Mapping of common first-run Gemini failures ---


def genai_error(code: int, message: str, status: str) -> ClientError:
    return ClientError(code, {"error": {"code": code, "message": message, "status": status}})


def wrapped(inner: BaseException, wrapper: type[Exception] = RuntimeError) -> Exception:
    """`wrapper` raised `from inner`, as langchain-google-genai does."""
    try:
        try:
            raise inner
        except BaseException as e:
            raise wrapper(f"Error calling model: {e}") from e
    except Exception as outer:
        return outer


def test_region_not_supported_is_502():
    exc = wrapped(
        genai_error(400, "User location is not supported for the API use.", "FAILED_PRECONDITION"),
        GoogleInvalidRequestError,
    )
    assert classify_llm_error(exc) == (502, REGION_MESSAGE)
    assert REGION_MESSAGE == "Gemini API недоступен из вашего региона. Укажите HTTPS_PROXY в .env или включите VPN"


def test_invalid_api_key_400_is_502():
    exc = wrapped(
        genai_error(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT"),
        GoogleInvalidRequestError,
    )
    assert classify_llm_error(exc) == (502, INVALID_KEY_MESSAGE)
    assert INVALID_KEY_MESSAGE == "Неверный GOOGLE_API_KEY. Проверьте ключ в .env"


@pytest.mark.parametrize(
    ("code", "status", "wrapper"),
    [(401, "UNAUTHENTICATED", GoogleAuthenticationError), (403, "PERMISSION_DENIED", GooglePermissionDeniedError)],
)
def test_401_403_is_invalid_key(code, status, wrapper):
    exc = wrapped(genai_error(code, "Request had invalid authentication credentials.", status), wrapper)
    assert classify_llm_error(exc) == (502, INVALID_KEY_MESSAGE)


def test_404_is_model_not_found():
    exc = wrapped(
        genai_error(404, "models/gemini-x is not found for API version v1beta", "NOT_FOUND"), GoogleModelNotFoundError
    )
    assert classify_llm_error(exc) == (502, MODEL_NOT_FOUND_MESSAGE)
    assert MODEL_NOT_FOUND_MESSAGE == "Модель не найдена. Проверьте CHAT_MODEL и EMBEDDING_MODEL в .env"


def test_genai_429_is_503():
    exc = wrapped(genai_error(429, "Resource has been exhausted", "RESOURCE_EXHAUSTED"))
    assert classify_llm_error(exc) == (503, "Превышен лимит запросов к Gemini API, попробуйте позже")


@pytest.mark.parametrize(
    "inner",
    [
        httpx.ConnectError("[Errno 61] Connection refused"),
        httpx.ConnectTimeout("timed out"),
        httpx.ReadTimeout("timed out"),
        aiohttp.ClientConnectionError("Cannot connect to host"),
        asyncio.TimeoutError(),
    ],
    ids=["httpx-connect", "httpx-connect-timeout", "httpx-read-timeout", "aiohttp-connection", "asyncio-timeout"],
)
def test_network_errors_are_502(inner):
    assert classify_llm_error(wrapped(inner)) == (502, NETWORK_MESSAGE)
    assert classify_llm_error(inner) == (502, NETWORK_MESSAGE)
    assert NETWORK_MESSAGE == "Нет связи с Gemini API. Проверьте сеть и HTTPS_PROXY"


def test_other_genai_error_keeps_generic_text():
    exc = genai_error(400, "Invalid JSON payload received.", "INVALID_ARGUMENT")
    assert classify_llm_error(exc) == (502, "Ошибка обращения к Gemini API: ClientError")


def test_cyclic_context_chain_terminates():
    a, b = RuntimeError("a"), RuntimeError("b")
    a.__context__, b.__context__ = b, a
    assert classify_llm_error(a) == (502, "Ошибка обращения к Gemini API: RuntimeError")


def test_context_chain_is_walked():
    try:
        try:
            raise genai_error(404, "not found", "NOT_FOUND")
        except ClientError:
            raise RuntimeError("during handling")  # implicit __context__, no __cause__
    except RuntimeError as exc:
        assert classify_llm_error(exc) == (502, MODEL_NOT_FOUND_MESSAGE)

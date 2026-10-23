from app.errors import classify_llm_error


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

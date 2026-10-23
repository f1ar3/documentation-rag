import json
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from langchain_core.embeddings import DeterministicFakeEmbedding
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.errors import RATE_LIMIT_MESSAGE
from app.main import create_app
from tests.fakes import RaiseAfter, ScriptedChatModel, make_pdf

LONG = "Сотрудник имеет право на ежегодный оплачиваемый отпуск продолжительностью двадцать восемь календарных дней. " * 3
ANSWER = "Отпуск 28 дней [a.pdf, стр. 1]."
NO_ANSWER = "В загруженных документах нет ответа на этот вопрос"


class RateLimitError(Exception):
    code = 429


def search_call(call_id: str = "c1") -> AIMessage:
    return AIMessage("", tool_calls=[{"name": "search_documents", "args": {"query": "отпуск"}, "id": call_id}])


@pytest.fixture
def make_client(keyed_settings):
    """Factory: a TestClient whose chat model plays the given scripted responses."""

    @contextmanager
    def factory(responses):
        app = create_app(
            keyed_settings,
            embeddings=DeterministicFakeEmbedding(size=64),
            chat_model=ScriptedChatModel(responses=responses),
        )
        with TestClient(app) as c:
            yield c

    factory.settings = keyed_settings
    return factory


def upload_pdf(client, tmp_path) -> None:
    pdf = make_pdf(tmp_path / "src.pdf", [LONG])
    resp = client.post("/api/documents", files=[("files", ("a.pdf", pdf.read_bytes()))])
    assert resp.status_code == 200


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    name = None
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if line.startswith("event:"):
            name = line[len("event:") :].strip()
        elif line.startswith("data:"):
            events.append((name, json.loads(line[len("data:") :].strip())))
            name = None
    return events


def chat(client, message: str, thread_id: str = "t1"):
    resp = client.post("/api/chat", json={"thread_id": thread_id, "message": message})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    return resp, parse_sse(resp.text)


def tokens(events) -> list[str]:
    return [data["text"] for name, data in events if name == "token"]


def sources(events):
    found = [data["sources"] for name, data in events if name == "sources"]
    assert len(found) == 1
    return found[0]


def test_chat_streams_tokens_and_sources(make_client, tmp_path):
    with make_client([search_call(), AIMessage(ANSWER)]) as client:
        upload_pdf(client, tmp_path)
        resp, events = chat(client, "Сколько дней отпуска?")
    toks = tokens(events)
    assert len(toks) >= 2
    assert all(toks)
    assert "".join(toks) == ANSWER
    assert sources(events) == [{"source": "a.pdf", "page": 1, "section": None}]
    assert '"section": null' in resp.text
    assert "Отпуск" in resp.text  # Cyrillic is not escaped
    assert [name for name, _ in events][-2:] == ["sources", "done"]
    assert events[-1] == ("done", {})


def test_chat_no_answer_has_empty_sources(make_client, tmp_path):
    with make_client([search_call(), AIMessage(NO_ANSWER)]) as client:
        upload_pdf(client, tmp_path)
        _, events = chat(client, "Сколько стоит обед?")
    assert "".join(tokens(events)) == NO_ANSWER
    assert sources(events) == []
    assert events[-1][0] == "done"


def test_chat_drops_hallucinated_source(make_client, tmp_path):
    with make_client([search_call(), AIMessage("Отпуск 28 дней [a.pdf, стр. 7].")]) as client:
        upload_pdf(client, tmp_path)
        _, events = chat(client, "Сколько дней отпуска?")
    assert sources(events) == []


def test_chat_error_mid_stream(make_client, tmp_path):
    responses = [
        search_call(),
        RaiseAfter("Отпуск составляет", RateLimitError("429 Resource exhausted")),
        search_call("c2"),
        AIMessage(ANSWER),
    ]
    with make_client(responses) as client:
        upload_pdf(client, tmp_path)
        _, events = chat(client, "Сколько дней отпуска?")
        names = [name for name, _ in events]
        assert "token" in names
        assert names[-2:] == ["error", "done"]
        assert names.index("token") < names.index("error")
        assert events[-2][1] == {"message": RATE_LIMIT_MESSAGE}
        assert "sources" not in names

        _, events = chat(client, "Повторю вопрос: сколько дней отпуска?")
        assert "".join(tokens(events)) == ANSWER
        assert events[-1][0] == "done"
        assert sources(events) == [{"source": "a.pdf", "page": 1, "section": None}]

        history = client.get("/api/chat/t1/history").json()["messages"]
    assert [(m["role"], m["content"]) for m in history] == [
        ("user", "Сколько дней отпуска?"),
        ("user", "Повторю вопрос: сколько дней отпуска?"),
        ("assistant", ANSWER),
    ]


def test_history_roundtrip(make_client, tmp_path):
    with make_client([search_call(), AIMessage(ANSWER)]) as client:
        upload_pdf(client, tmp_path)
        chat(client, "Сколько дней отпуска?")
        resp = client.get("/api/chat/t1/history")
        assert resp.status_code == 200
        assert resp.json() == {
            "messages": [
                {"role": "user", "content": "Сколько дней отпуска?", "sources": []},
                {
                    "role": "assistant",
                    "content": ANSWER,
                    "sources": [{"source": "a.pdf", "page": 1, "section": None}],
                },
            ]
        }
        assert client.get("/api/chat/unknown/history").json() == {"messages": []}


def test_chat_validation(make_client):
    with make_client([]) as client:
        for body in (
            {"thread_id": "t1", "message": "   "},
            {"thread_id": "t1", "message": ""},
            {"thread_id": "t1", "message": "a" * 4001},
            {"thread_id": "", "message": "Привет"},
            {"thread_id": "t" * 101, "message": "Привет"},
            {"message": "Привет"},
            {"thread_id": "t1"},
        ):
            assert client.post("/api/chat", json=body).status_code == 422, body


def test_chat_requires_key(tmp_settings):
    with TestClient(create_app(tmp_settings)) as client:
        resp = client.post("/api/chat", json={"thread_id": "t1", "message": "Привет"})
        assert resp.status_code == 503
        assert resp.json()["detail"] == "Не задан GOOGLE_API_KEY"
        assert client.get("/api/chat/t1/history").status_code == 503


def test_history_survives_restart(make_client, tmp_path):
    with make_client([search_call(), AIMessage(ANSWER)]) as client:
        upload_pdf(client, tmp_path)
        chat(client, "Сколько дней отпуска?")
        before = client.get("/api/chat/t1/history").json()
    assert len(before["messages"]) == 2
    with make_client([]) as client:
        assert client.get("/api/chat/t1/history").json() == before


def test_sources_event_carries_final_answer(make_client, tmp_path):
    pre_tool = AIMessage(
        "Сейчас поищу.", tool_calls=[{"name": "search_documents", "args": {"query": "отпуск"}, "id": "c1"}]
    )
    final = "Ответ [a.pdf, стр. 1]."
    with make_client([pre_tool, AIMessage(final)]) as client:
        upload_pdf(client, tmp_path)
        _, events = chat(client, "Сколько дней отпуска?")
        history = client.get("/api/chat/t1/history").json()["messages"]
    assert "Сейчас поищу." in "".join(tokens(events))
    payload = [data for name, data in events if name == "sources"][0]
    assert payload == {"answer": final, "sources": [{"source": "a.pdf", "page": 1, "section": None}]}
    assert history[-1]["role"] == "assistant"
    assert history[-1]["content"] == final


def assert_no_dangling_tool_calls(messages) -> None:
    for i, msg in enumerate(messages):
        if isinstance(msg, AIMessage) and msg.tool_calls:
            following = messages[i + 1 :]
            answered = {m.tool_call_id for m in following if isinstance(m, ToolMessage)}
            assert {tc["id"] for tc in msg.tool_calls} <= answered, msg.tool_calls


def test_tool_error_repairs_thread(make_client, tmp_path):
    model = ScriptedChatModel(responses=[search_call("c1"), AIMessage("Привет!")])
    app = create_app(
        make_client.settings, embeddings=DeterministicFakeEmbedding(size=64), chat_model=model
    )
    with TestClient(app) as client:
        upload_pdf(client, tmp_path)
        store = app.state.store

        def broken_search(*args, **kwargs):
            raise RuntimeError("chroma is down")

        original = store.search
        store.search = broken_search
        try:
            _, events = chat(client, "Сколько дней отпуска?")
        finally:
            store.search = original
        names = [name for name, _ in events]
        assert names[-2:] == ["error", "done"]
        assert events[-2][1]["message"].startswith("Ошибка обращения к Gemini API")

        _, events = chat(client, "Привет")
        assert "".join(tokens(events)) == "Привет!"
        assert events[-1][0] == "done"

        assert len(model.calls) == 2  # the repaired thread does not trigger an extra model step
        next_input = model.calls[-1]
        assert isinstance(next_input[-1], HumanMessage) and next_input[-1].content == "Привет"
        assert any(isinstance(m, ToolMessage) and m.tool_call_id == "c1" for m in next_input)
        assert_no_dangling_tool_calls(next_input)

        history = client.get("/api/chat/t1/history").json()["messages"]
    assert [(m["role"], m["content"]) for m in history] == [
        ("user", "Сколько дней отпуска?"),
        ("user", "Привет"),
        ("assistant", "Привет!"),
    ]


def test_repair_failure_still_ends_stream(make_client, tmp_path, caplog):
    model = ScriptedChatModel(responses=[search_call("c1")])
    app = create_app(make_client.settings, embeddings=DeterministicFakeEmbedding(size=64), chat_model=model)
    with TestClient(app) as client:
        upload_pdf(client, tmp_path)

        def broken_search(*args, **kwargs):
            raise RuntimeError("chroma is down")

        async def broken_update(*args, **kwargs):
            raise RuntimeError("sqlite is down")

        app.state.store.search = broken_search
        app.state.agent.aupdate_state = broken_update
        _, events = chat(client, "Сколько дней отпуска?")
    assert [name for name, _ in events][-2:] == ["error", "done"]
    assert any("Не удалось восстановить историю чата" in r.getMessage() for r in caplog.records)

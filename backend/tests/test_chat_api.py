import json
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from langchain_core.embeddings import DeterministicFakeEmbedding
from langchain_core.messages import AIMessage

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

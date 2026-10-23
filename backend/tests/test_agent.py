import pytest
from langchain_core.documents import Document
from langchain_core.embeddings import DeterministicFakeEmbedding
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from app.agent import SYSTEM_PROMPT, build_agent, make_tools
from app.vectorstore import DocumentStore
from tests.fakes import RaiseAfter, ScriptedChatModel


@pytest.fixture
def store(tmp_path) -> DocumentStore:
    return DocumentStore(tmp_path / "chroma", DeterministicFakeEmbedding(size=64))


def chunk(text: str, source: str, page: int | None = None, section: str | None = None, i: int = 0) -> Document:
    return Document(page_content=text, metadata={"source": source, "page": page, "section": section, "chunk_index": i})


def tools_by_name(store: DocumentStore, k: int = 5):
    return {t.name: t for t in make_tools(store, k)}


def call(tool, args: dict) -> ToolMessage:
    return tool.invoke({"type": "tool_call", "id": "call-1", "name": tool.name, "args": args})


def test_search_tool_format_and_artifact(store):
    store.add("a.pdf", [chunk("Ежегодный отпуск 28 календарных дней.", "a.pdf", page=2)])
    msg = call(tools_by_name(store)["search_documents"], {"query": "отпуск"})
    assert isinstance(msg, ToolMessage)
    assert msg.content.startswith("[a.pdf, стр. 2]\nЕжегодный отпуск")
    assert msg.artifact == [{"source": "a.pdf", "page": 2, "section": None}]

    store.add("b.md", [chunk("Ноутбук выдаёт ИТ-отдел.", "b.md", section="Оборудование")])
    msg = call(tools_by_name(store)["search_documents"], {"query": "ноутбук"})
    assert '[b.md, раздел "Оборудование"]\nНоутбук' in msg.content
    assert "\n\n---\n\n" in msg.content
    assert {"source": "b.md", "page": None, "section": "Оборудование"} in msg.artifact
    assert len(msg.artifact) == 2


def test_search_tool_respects_k(store):
    store.add("c.txt", [chunk(f"фрагмент {i}", "c.txt", i=i) for i in range(4)])
    msg = call(tools_by_name(store, k=2)["search_documents"], {"query": "фрагмент"})
    assert msg.content.count("[c.txt]") == 2


def test_search_tool_empty_store(store):
    msg = call(tools_by_name(store)["search_documents"], {"query": "отпуск"})
    assert msg.content == "База документов пуста. Загрузите регламенты (PDF, DOCX, MD, TXT)."
    assert msg.artifact == []


def test_list_documents_tool(store):
    tool = tools_by_name(store)["list_documents"]
    assert call(tool, {}).content == "Документы не загружены."
    store.add("a.pdf", [chunk("x", "a.pdf", page=1, i=0), chunk("y", "a.pdf", page=1, i=1)])
    store.add("b.md", [chunk("z", "b.md")])
    assert call(tool, {}).content == "- a.pdf (2 фрагм.)\n- b.md (1 фрагм.)"


def test_system_prompt_requirements():
    assert "search_documents" in SYSTEM_PROMPT
    assert "list_documents" in SYSTEM_PROMPT
    assert "В загруженных документах нет ответа на этот вопрос" in SYSTEM_PROMPT
    assert "\u2014" not in SYSTEM_PROMPT and "\u2013" not in SYSTEM_PROMPT


async def test_agent_calls_search_then_answers(store):
    store.add("a.pdf", [chunk("Ежегодный отпуск 28 календарных дней.", "a.pdf", page=2)])
    model = ScriptedChatModel(
        responses=[
            AIMessage("", tool_calls=[{"name": "search_documents", "args": {"query": "отпуск"}, "id": "c1"}]),
            AIMessage("28 дней [a.pdf, стр. 2]"),
        ]
    )
    agent = build_agent(model, store, 5, InMemorySaver())
    state = await agent.ainvoke(
        {"messages": [HumanMessage("Сколько дней отпуска?")]}, {"configurable": {"thread_id": "t1"}}
    )
    tool_msgs = [m for m in state["messages"] if isinstance(m, ToolMessage)]
    assert [m.name for m in tool_msgs] == ["search_documents"]
    assert tool_msgs[0].artifact == [{"source": "a.pdf", "page": 2, "section": None}]
    last = state["messages"][-1]
    assert isinstance(last, AIMessage)
    assert last.content == "28 дней [a.pdf, стр. 2]"


async def test_memory_by_thread(store):
    model = ScriptedChatModel(responses=[AIMessage("Привет!"), AIMessage("Вы спросили про привет."), AIMessage("Здравствуйте!")])
    agent = build_agent(model, store, 5, InMemorySaver())

    def humans(messages):
        return [m.content for m in messages if isinstance(m, HumanMessage)]

    await agent.ainvoke({"messages": [HumanMessage("Привет")]}, {"configurable": {"thread_id": "t1"}})
    await agent.ainvoke({"messages": [HumanMessage("Что я спросил?")]}, {"configurable": {"thread_id": "t1"}})
    assert humans(model.calls[-1]) == ["Привет", "Что я спросил?"]

    await agent.ainvoke({"messages": [HumanMessage("Новый диалог")]}, {"configurable": {"thread_id": "t2"}})
    assert humans(model.calls[-1]) == ["Новый диалог"]


# --- ScriptedChatModel itself (Task 7 relies on its streaming behaviour) ---


async def test_scripted_streams_text_in_several_chunks():
    model = ScriptedChatModel(responses=[AIMessage("Ежегодный отпуск 28 дней")])
    chunks = [c async for c in model.astream("вопрос")]
    assert len(chunks) >= 2
    assert "".join(c.content for c in chunks) == "Ежегодный отпуск 28 дней"


def test_scripted_sync_stream_and_invoke():
    model = ScriptedChatModel(responses=[AIMessage("раз два три"), AIMessage("ответ")])
    chunks = list(model.stream("вопрос"))
    assert len(chunks) >= 2
    assert "".join(c.content for c in chunks) == "раз два три"
    assert model.invoke("ещё").content == "ответ"
    assert len(model.calls) == 2


async def test_scripted_tool_calls_survive_streaming():
    tc = {"name": "search_documents", "args": {"query": "отпуск"}, "id": "c1"}
    model = ScriptedChatModel(responses=[AIMessage("Ищу", tool_calls=[tc])])
    agg = None
    async for c in model.astream("вопрос"):
        assert isinstance(c, AIMessageChunk)
        agg = c if agg is None else agg + c
    assert agg.content == "Ищу"
    assert [(t["name"], t["args"], t["id"]) for t in agg.tool_calls] == [("search_documents", {"query": "отпуск"}, "c1")]


async def test_scripted_ainvoke_keeps_tool_calls():
    tc = {"name": "list_documents", "args": {}, "id": "c9"}
    model = ScriptedChatModel(responses=[AIMessage("", tool_calls=[tc])])
    msg = await model.ainvoke("вопрос")
    assert [(t["name"], t["args"], t["id"]) for t in msg.tool_calls] == [("list_documents", {}, "c9")]


async def test_scripted_raise_after_yields_text_then_raises():
    model = ScriptedChatModel(responses=[RaiseAfter("Начало ответа", RuntimeError("429 лимит"))])
    got = []
    with pytest.raises(RuntimeError, match="429 лимит"):
        async for c in model.astream("вопрос"):
            got.append(c.content)
    assert "".join(got) == "Начало ответа"


def test_scripted_runs_out_of_responses():
    model = ScriptedChatModel(responses=[AIMessage("один")])
    model.invoke("a")
    with pytest.raises(RuntimeError, match="ran out of responses"):
        model.invoke("b")


def test_scripted_bind_tools_returns_self():
    model = ScriptedChatModel(responses=[])
    assert model.bind_tools([]) is model


def test_system_prompt_requires_separate_brackets():
    from app.agent import SYSTEM_PROMPT

    assert "[a.pdf, стр. 2] [a.pdf, стр. 3]" in SYSTEM_PROMPT

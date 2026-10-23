"""Client abort (Stop / chat switch) while the search tool runs must not leave a dangling tool call."""

import asyncio

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

from app.chat import INTERRUPTED_TOOL_RESULT, stream_answer
from tests.fakes import ScriptedChatModel

THREAD = "t1"


def dangling(messages) -> list[str]:
    ids: list[str] = []
    for i, msg in enumerate(messages):
        if isinstance(msg, AIMessage) and msg.tool_calls:
            answered = {m.tool_call_id for m in messages[i + 1 :] if isinstance(m, ToolMessage)}
            ids += [tc["id"] for tc in msg.tool_calls if tc["id"] not in answered]
    return ids


def make_agent(model):
    started = asyncio.Event()
    never = asyncio.Event()

    @tool("search_documents")
    async def search_documents(query: str) -> str:
        """Search."""
        started.set()
        await never.wait()  # blocks until cancelled
        return "unreachable"

    agent = create_agent(model, tools=[search_documents], checkpointer=InMemorySaver())
    return agent, started


async def consume(agent, message: str) -> list[dict]:
    return [event async for event in stream_answer(agent, THREAD, message)]


def search_call() -> AIMessage:
    return AIMessage("", tool_calls=[{"id": "c1", "name": "search_documents", "args": {"query": "отпуск"}}])


async def test_cancel_during_tool_call_keeps_thread_usable():
    model = ScriptedChatModel(responses=[search_call(), AIMessage("Привет!")])
    agent, started = make_agent(model)

    task = asyncio.create_task(consume(agent, "Сколько дней отпуска?"))
    await asyncio.wait_for(started.wait(), timeout=5)
    task.cancel()  # what sse-starlette does when the client disconnects
    try:
        await task
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError("the stream must propagate cancellation")

    state = await agent.aget_state({"configurable": {"thread_id": THREAD}})
    assert dangling(state.values["messages"]) == []

    events = await consume(agent, "Привет")
    assert [e["event"] for e in events][-2:] == ["sources", "done"]
    assert "".join(e["data"]["text"] for e in events if e["event"] == "token") == "Привет!"

    next_input = model.calls[-1]
    assert isinstance(next_input[-1], HumanMessage) and next_input[-1].content == "Привет"
    assert dangling(next_input) == []
    assert any(isinstance(m, ToolMessage) and m.content == INTERRUPTED_TOOL_RESULT for m in next_input)


async def test_dangling_call_from_older_turn_is_repaired_before_next_run():
    """A checkpoint broken earlier (e.g. by an old version or a killed process) is repaired at the next turn."""
    model = ScriptedChatModel(responses=[AIMessage("Привет!")])
    agent, _ = make_agent(model)
    config = {"configurable": {"thread_id": THREAD}}
    await agent.aupdate_state(config, {"messages": [HumanMessage("Сколько дней отпуска?"), search_call()]}, as_node="model")
    assert dangling((await agent.aget_state(config)).values["messages"]) == ["c1"]

    events = await consume(agent, "Привет")
    assert events[-1]["event"] == "done"
    assert dangling(model.calls[-1]) == []


async def test_repair_failure_at_start_does_not_break_turn(caplog, monkeypatch):
    model = ScriptedChatModel(responses=[AIMessage("Привет!")])
    agent, _ = make_agent(model)

    original = agent.aget_state
    calls = {"n": 0}

    async def flaky_get_state(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("sqlite is down")
        return await original(*args, **kwargs)

    monkeypatch.setattr(agent, "aget_state", flaky_get_state)
    events = await consume(agent, "Привет")
    assert [e["event"] for e in events][-2:] == ["sources", "done"]
    assert any("Не удалось восстановить историю чата" in r.getMessage() for r in caplog.records)

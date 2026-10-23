from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, ToolMessage

from app.citations import Source, extract_sources, found_sources_for_turn
from app.errors import classify_llm_error

logger = logging.getLogger(__name__)

MODEL_NODE = "model"
TOOLS_NODE = "tools"
INTERRUPTED_TOOL_RESULT = "Поиск прерван из-за ошибки."


def _config(thread_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": thread_id}}


def _is_final_answer(msg: BaseMessage) -> bool:
    return isinstance(msg, AIMessage) and not msg.tool_calls


def _answer_sources(messages: list[BaseMessage], index: int) -> list[Source]:
    """Sources of the assistant answer at `index`: cited labels that the search of the same turn returned."""
    return extract_sources(messages[index].text, found_sources_for_turn(messages[: index + 1]))


async def _state_messages(agent: Any, thread_id: str) -> list[BaseMessage]:
    state = await agent.aget_state(_config(thread_id))
    return list((state.values or {}).get("messages", []))


def _dangling_tool_calls(messages: list[BaseMessage]) -> list[dict]:
    """Tool calls of the last AIMessage that have no ToolMessage after it."""
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if isinstance(msg, AIMessage):
            answered = {m.tool_call_id for m in messages[i + 1 :] if isinstance(m, ToolMessage)}
            return [tc for tc in msg.tool_calls if tc["id"] not in answered]
        if isinstance(msg, HumanMessage):
            return []
    return []


async def _repair_thread(agent: Any, thread_id: str) -> None:
    """After a failed or cancelled run, answer tool calls left without results, so the next turn's model input is valid.

    Providers reject a history where an AIMessage with tool_calls is not followed by ToolMessages for every id.
    The update is written as the "tools" node: the same writer that normally appends tool results.
    """
    config = _config(thread_id)
    dangling = _dangling_tool_calls(await _state_messages(agent, thread_id))
    if not dangling:
        return
    results = [
        ToolMessage(content=INTERRUPTED_TOOL_RESULT, tool_call_id=tc["id"], name=tc["name"]) for tc in dangling
    ]
    await agent.aupdate_state(config, {"messages": results}, as_node=TOOLS_NODE)


async def _safe_repair(agent: Any, thread_id: str) -> None:
    """_repair_thread that never raises: a failed repair is logged and the caller goes on."""
    try:
        await _repair_thread(agent, thread_id)
    except Exception:
        logger.exception("Не удалось восстановить историю чата %s", thread_id)


async def stream_answer(agent: Any, thread_id: str, message: str) -> AsyncIterator[dict]:
    """token* -> sources {answer, sources} -> done; on a failure during the run: token* -> error -> done."""
    config = _config(thread_id)
    # A previous run may have been cancelled mid-tool (client Stop / chat switch) and left a dangling tool call.
    await _safe_repair(agent, thread_id)
    try:
        async for chunk, metadata in agent.astream(
            {"messages": [{"role": "user", "content": message}]}, config, stream_mode="messages"
        ):
            if not isinstance(chunk, AIMessageChunk) or metadata.get("langgraph_node") != MODEL_NODE:
                continue
            text = chunk.text
            if text:
                yield {"event": "token", "data": {"text": text}}

        messages = await _state_messages(agent, thread_id)
        answer = ""
        sources: list[Source] = []
        if messages and _is_final_answer(messages[-1]):
            answer = messages[-1].text
            sources = _answer_sources(messages, len(messages) - 1)
        yield {"event": "sources", "data": {"answer": answer, "sources": sources}}
    except asyncio.CancelledError:
        # Client disconnect: sse-starlette cancels the generator. Repair the thread (shielded from the
        # cancellation) so the checkpoint does not keep a tool call without results, then re-raise.
        try:
            await asyncio.shield(_safe_repair(agent, thread_id))
        except asyncio.CancelledError:
            pass  # cancelled again while waiting: the shielded repair still runs to completion
        raise
    except Exception as exc:
        logger.warning("Ошибка при генерации ответа в чате %s", thread_id, exc_info=True)
        await _safe_repair(agent, thread_id)
        yield {"event": "error", "data": {"message": classify_llm_error(exc)[1]}}
    yield {"event": "done", "data": {}}


async def get_history(agent: Any, thread_id: str) -> list[dict]:
    """User questions and final assistant answers (tool calls and tool results are skipped)."""
    messages = await _state_messages(agent, thread_id)
    history: list[dict] = []
    for i, msg in enumerate(messages):
        if isinstance(msg, HumanMessage):
            history.append({"role": "user", "content": msg.text, "sources": []})
        elif _is_final_answer(msg) and msg.text:
            history.append({"role": "assistant", "content": msg.text, "sources": _answer_sources(messages, i)})
    return history

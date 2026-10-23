from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage

from app.citations import Source, extract_sources, found_sources_for_turn
from app.errors import classify_llm_error

logger = logging.getLogger(__name__)

MODEL_NODE = "model"


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


async def stream_answer(agent: Any, thread_id: str, message: str) -> AsyncIterator[dict]:
    """token* -> sources -> done; on a failure during the run: token* -> error -> done."""
    config = _config(thread_id)
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
        sources: list[Source] = []
        if messages and _is_final_answer(messages[-1]):
            sources = _answer_sources(messages, len(messages) - 1)
        yield {"event": "sources", "data": {"sources": sources}}
    except Exception as exc:  # CancelledError (client disconnect) is a BaseException and propagates
        logger.warning("Ошибка при генерации ответа в чате %s", thread_id, exc_info=True)
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

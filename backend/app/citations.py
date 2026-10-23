from __future__ import annotations

import re
from typing import TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage

SEARCH_TOOL_NAME = "search_documents"


class Source(TypedDict):
    source: str
    page: int | None
    section: str | None


def format_label(src: Source) -> str:
    if src["page"] is not None:
        return f"[{src['source']}, стр. {src['page']}]"
    if src["section"]:
        return f'[{src["source"]}, раздел "{src["section"]}"]'
    return f"[{src['source']}]"


# Name: anything except brackets, quotes, commas and newlines, ending with a supported extension.
CITATION_RE = re.compile(
    r"\[\s*(?P<name>[^\[\]\",\n]+?\.(?:pdf|docx|md|txt))"
    r"(?:\s*,\s*стр\.\s?(?P<page>\d+)|\s*,\s*раздел\s+\"(?P<section>[^\"\[\]\n]+)\")?"
    r"\s*\]",
    re.IGNORECASE,
)


def parse_citation(match: re.Match[str]) -> Source:
    page = match.group("page")
    return {
        "source": match.group("name").strip(),
        "page": int(page) if page is not None else None,
        "section": match.group("section"),
    }


def extract_sources(answer: str, found: list[Source]) -> list[Source]:
    """Labels cited in the answer that really came from the search, deduplicated, in order of first mention."""
    result: list[Source] = []
    for match in CITATION_RE.finditer(answer):
        src = parse_citation(match)
        if src in found and src not in result:
            result.append(src)
    return result


def found_sources_for_turn(messages: list[BaseMessage]) -> list[Source]:
    """Union of search_documents artifacts after the last HumanMessage."""
    start = 0
    for i, msg in enumerate(messages):
        if isinstance(msg, HumanMessage):
            start = i + 1
    result: list[Source] = []
    for msg in messages[start:]:
        if isinstance(msg, ToolMessage) and msg.name == SEARCH_TOOL_NAME:
            for src in msg.artifact or []:
                if src not in result:
                    result.append(src)
    return result

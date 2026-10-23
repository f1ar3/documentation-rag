from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from chromadb.config import Settings
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings


@dataclass(frozen=True)
class DocumentInfo:
    name: str
    chunks: int


@dataclass(frozen=True)
class SearchHit:
    source: str
    page: int | None
    section: str | None
    text: str


class DocumentStore:
    """The only place that talks to Chroma."""

    def __init__(self, persist_dir: Path, embeddings: Embeddings, collection: str = "regulations"):
        self._store = Chroma(
            collection_name=collection,
            embedding_function=embeddings,
            persist_directory=str(persist_dir),
            client_settings=Settings(
                anonymized_telemetry=False,
                is_persistent=True,
                persist_directory=str(persist_dir),
            ),
        )

    def add(self, source_name: str, chunks: list[Document]) -> int:
        if not chunks:
            self.delete(source_name)
            return 0
        docs: list[Document] = []
        ids: list[str] = []
        for chunk in chunks:
            meta = dict(chunk.metadata)
            meta["source"] = source_name
            meta["page"] = meta.get("page") or 0
            meta["section"] = meta.get("section") or ""
            docs.append(Document(page_content=chunk.page_content, metadata=meta))
            ids.append(f"{source_name}::{meta['chunk_index']}")
        # add_documents upserts on existing ids; old copy survives if embedding fails
        self._store.add_documents(docs, ids=ids)
        stale = set(self._source_ids(source_name)) - set(ids)
        if stale:
            self._store.delete(ids=list(stale))
        return len(docs)

    def list(self) -> list[DocumentInfo]:
        metadatas = self._store.get(include=["metadatas"])["metadatas"] or []
        counts = Counter(m["source"] for m in metadatas)
        return [DocumentInfo(name, counts[name]) for name in sorted(counts)]

    def _source_ids(self, source_name: str) -> list[str]:
        return self._store.get(where={"source": source_name}, include=[])["ids"]

    def delete(self, source_name: str) -> bool:
        ids = self._source_ids(source_name)
        if not ids:
            return False
        self._store.delete(ids=ids)
        return True

    def search(self, query: str, k: int) -> list[SearchHit]:
        if not self._store.get(limit=1, include=[])["ids"]:
            return []
        return [
            SearchHit(
                source=doc.metadata["source"],
                page=doc.metadata.get("page") or None,
                section=doc.metadata.get("section") or None,
                text=doc.page_content,
            )
            for doc in self._store.similarity_search(query, k=k)
        ]

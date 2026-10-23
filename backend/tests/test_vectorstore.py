from pathlib import Path

import pytest
from langchain_core.documents import Document
from langchain_core.embeddings import DeterministicFakeEmbedding

from app.vectorstore import DocumentInfo, DocumentStore, SearchHit


@pytest.fixture
def store(tmp_path: Path) -> DocumentStore:
    return DocumentStore(tmp_path, DeterministicFakeEmbedding(size=64))


def make_chunks(
    source: str, n: int, page: int | None = None, section: str | None = None
) -> list[Document]:
    return [
        Document(
            page_content=f"Текст чанка {i} документа {source}",
            metadata={"source": source, "page": page, "section": section, "chunk_index": i},
        )
        for i in range(n)
    ]


def test_add_and_list(store: DocumentStore):
    assert store.add("a.pdf", make_chunks("a.pdf", 3)) == 3
    assert store.add("b.pdf", make_chunks("b.pdf", 2)) == 2
    assert store.list() == [DocumentInfo("a.pdf", 3), DocumentInfo("b.pdf", 2)]


def test_readd_replaces_without_duplicates(store: DocumentStore):
    store.add("a.pdf", make_chunks("a.pdf", 3))
    store.add("a.pdf", make_chunks("a.pdf", 1))
    assert store.list() == [DocumentInfo("a.pdf", 1)]


def test_delete(store: DocumentStore):
    store.add("a.pdf", make_chunks("a.pdf", 3))
    assert store.delete("a.pdf") is True
    assert store.delete("a.pdf") is False
    assert store.list() == []


def test_search_returns_hits_with_metadata(store: DocumentStore):
    chunks = [
        Document(
            page_content="Первый текст",
            metadata={"source": "a.pdf", "page": 2, "section": None, "chunk_index": 0},
        ),
        Document(
            page_content="Второй текст",
            metadata={"source": "b.docx", "page": None, "section": "Раздел", "chunk_index": 0},
        ),
    ]
    store.add("a.pdf", chunks[:1])
    store.add("b.docx", chunks[1:])
    hits = store.search("текст", k=2)
    assert len(hits) == 2
    assert all(isinstance(h, SearchHit) and h.text for h in hits)
    assert {(h.source, h.page, h.section) for h in hits} == {
        ("a.pdf", 2, None),
        ("b.docx", None, "Раздел"),
    }
    # caller's documents are not mutated
    assert chunks[0].metadata["section"] is None
    assert chunks[1].metadata["page"] is None


def test_search_empty_store(store: DocumentStore):
    assert store.search("что угодно", 5) == []


def test_persists_between_instances(tmp_path: Path):
    emb = DeterministicFakeEmbedding(size=64)
    DocumentStore(tmp_path, emb).add("a.pdf", make_chunks("a.pdf", 2))
    assert DocumentStore(tmp_path, emb).list() == [DocumentInfo("a.pdf", 2)]

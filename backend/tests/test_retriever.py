from pathlib import Path

import pytest
from langchain_core.documents import Document
from langchain_core.embeddings import DeterministicFakeEmbedding

from app.retriever import russian_tokenize
from app.vectorstore import DocumentStore


@pytest.fixture
def store(tmp_path: Path) -> DocumentStore:
    return DocumentStore(tmp_path, DeterministicFakeEmbedding(size=64))


def chunks(source: str, texts: list[str]) -> list[Document]:
    return [
        Document(
            page_content=t,
            metadata={"source": source, "page": None, "section": None, "chunk_index": i},
        )
        for i, t in enumerate(texts)
    ]


def noise(n: int = 30) -> list[str]:
    return [f"Общие положения номер {i} о порядке работы подразделения {i * 7}" for i in range(n)]


def test_russian_tokenize():
    tokens = russian_tokenize("Отпуска по п. 3.2 - 1500 руб.")
    assert "3.2" in tokens
    assert "1500" in tokens
    assert russian_tokenize("отпуск")[0] in tokens
    assert russian_tokenize("отпуск") == russian_tokenize("отпуска")
    assert "1,5" in russian_tokenize("доплата 1,5 раза")


def test_exact_term_found_by_bm25(store: DocumentStore):
    store.add("noise.txt", chunks("noise.txt", noise()))
    store.add("secret.txt", chunks("secret.txt", ["Служебный код доступа QX-7781 выдаётся в IT"]))
    hits = store.search("QX-7781", 5)
    assert hits[0].source == "secret.txt"


def test_morphology(store: DocumentStore):
    store.add("noise.txt", chunks("noise.txt", noise()))
    store.add("leave.txt", chunks("leave.txt", ["Ежегодный оплачиваемый отпуск составляет 28 дней"]))
    hits = store.search("сколько дней отпуска", 5)
    assert any(h.source == "leave.txt" for h in hits)


def test_bm25_updates_on_add_and_delete(store: DocumentStore):
    store.add("noise.txt", chunks("noise.txt", noise()))
    store.add("a.txt", chunks("a.txt", ["Уникальный термин ZORBLAX упомянут здесь"]))
    assert store.search("ZORBLAX", 3)[0].source == "a.txt"
    store.delete("a.txt")
    assert all(h.source != "a.txt" for h in store.search("ZORBLAX", 5))
    store.add("b.txt", chunks("b.txt", ["Другой уникальный термин FLUMMOX описан тут"]))
    assert store.search("FLUMMOX", 3)[0].source == "b.txt"


def test_bm25_restored_after_restart(tmp_path: Path):
    emb = DeterministicFakeEmbedding(size=64)
    first = DocumentStore(tmp_path, emb)
    first.add("noise.txt", chunks("noise.txt", noise()))
    first.add("a.txt", chunks("a.txt", ["Редкий термин GRIBBLE в документе"]))
    second = DocumentStore(tmp_path, emb)
    assert second.search("GRIBBLE", 3)[0].source == "a.txt"


def test_search_empty_store_still_empty(store: DocumentStore):
    assert store.search("что угодно", 5) == []


def test_hybrid_returns_at_most_k_and_no_duplicates(store: DocumentStore):
    store.add("noise.txt", chunks("noise.txt", noise()))
    hits = store.search("общие положения порядок", 3)
    assert len(hits) <= 3
    keys = [(h.source, h.text) for h in hits]
    assert len(keys) == len(set(keys))


def test_bm25_single_chunk_corpus(store: DocumentStore):
    store.add("one.txt", chunks("one.txt", ["Код доступа QX-7781 выдаётся в IT"]))
    assert [h.source for h in store.search("QX-7781", 5)] == ["one.txt"]
    assert len(store._bm25.invoke("QX-7781")) == 1


def test_bm25_two_chunk_corpus(store: DocumentStore):
    store.add("a.txt", chunks("a.txt", ["Код доступа QX-7781 выдаётся в IT", "Совсем другой текст"]))
    assert store.search("QX-7781", 5)[0].text.startswith("Код доступа")
    assert [d.page_content[:11] for d in store._bm25.invoke("QX-7781")] == ["Код доступа"]


def test_bm25_term_in_half_of_chunks():
    from app.retriever import build_bm25

    docs = [
        Document(page_content=t, metadata={"chunk_id": str(i)})
        for i, t in enumerate(["alpha beta", "alpha gamma", "delta", "epsilon"])
    ]
    bm25 = build_bm25(docs, 10)
    found = [d.page_content for d in bm25.invoke("alpha")]
    assert found == ["alpha beta", "alpha gamma"]


def test_legacy_chunk_without_chunk_id(tmp_path: Path):
    emb = DeterministicFakeEmbedding(size=64)
    legacy = DocumentStore(tmp_path, emb)
    legacy._store.add_documents(
        [Document(page_content="Старый чанк с термином LEGACYTERM",
                  metadata={"source": "old.txt", "page": 0, "section": "", "chunk_index": 0})],
        ids=["old.txt::0"],
    )
    store = DocumentStore(tmp_path, emb)
    hits = store.search("LEGACYTERM", 5)
    assert [h.source for h in hits] == ["old.txt"]

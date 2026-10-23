from __future__ import annotations

import re

import snowballstemmer
from langchain_classic.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever

_TOKEN_RE = re.compile(r"\w+(?:[.,]\w+)*")
_CYRILLIC_RE = re.compile(r"[а-яё]")
_RU = snowballstemmer.stemmer("russian")
_EN = snowballstemmer.stemmer("english")


def russian_tokenize(text: str) -> list[str]:
    """Lowercase tokens; Cyrillic words get Russian stems, Latin words English stems, numbers stay intact."""
    tokens: list[str] = []
    for token in _TOKEN_RE.findall(text.lower()):
        if any(ch.isdigit() for ch in token):
            tokens.append(token)
        elif _CYRILLIC_RE.search(token):
            tokens.append(_RU.stemWord(token))
        else:
            tokens.append(_EN.stemWord(token))
    return tokens


class _ScoredBM25Retriever(BM25Retriever):
    """BM25Retriever that drops zero-score documents.

    The stock retriever pads results with unrelated chunks when fewer than k match;
    in rank fusion that padding would add spurious scores to unrelated chunks.
    """

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> list[Document]:
        scores = self.vectorizer.get_scores(self.preprocess_func(query))
        ranked = sorted(range(len(self.docs)), key=lambda i: scores[i], reverse=True)
        return [self.docs[i] for i in ranked[: self.k] if scores[i] > 0]


class HybridRetriever(BaseRetriever):
    """BM25 + vector retrieval fused with Reciprocal Rank Fusion."""

    vector_retriever: BaseRetriever
    bm25_retriever: BaseRetriever
    bm25_weight: float
    k: int

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> list[Document]:
        ensemble = EnsembleRetriever(
            retrievers=[self.bm25_retriever, self.vector_retriever],
            weights=[self.bm25_weight, 1 - self.bm25_weight],
            id_key="chunk_id",
        )
        return ensemble.invoke(query)[: self.k]


def build_bm25(documents: list[Document], candidates: int) -> BM25Retriever | None:
    if not documents:
        return None
    return _ScoredBM25Retriever.from_documents(documents, preprocess_func=russian_tokenize, k=candidates)

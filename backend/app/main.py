import json
import logging
import os
import re
import tempfile
import unicodedata
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi import Path as FastAPIPath
from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel, Field, field_validator
from sse_starlette import EventSourceResponse

from app.agent import build_agent
from app.chat import get_history, stream_answer
from app.config import Settings
from app.errors import classify_llm_error
from app.ingestion import SUPPORTED_EXTENSIONS, IngestionError, UnsupportedFormatError, load_and_split
from app.vectorstore import DocumentStore

logger = logging.getLogger(__name__)

NOT_CONFIGURED_DETAIL = "Не задан GOOGLE_API_KEY"
_PCT_CONTROL_RE = re.compile(r"%[01][0-9A-Fa-f]")
_CHUNK = 1024 * 1024
MAX_NAME_BYTES = 200
_REMOVED_NAME_CHARS = str.maketrans("", "", '"[]')


class ChatRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Сообщение не может состоять только из пробелов")
        return value


async def _sse_events(agent, thread_id: str, message: str) -> AsyncIterator[dict[str, str]]:
    async for event in stream_answer(agent, thread_id, message):
        yield {"event": event["event"], "data": json.dumps(event["data"], ensure_ascii=False)}


def require_configured(request: Request) -> None:
    """Зависимость для всех /api/* роутов: 503, если нет ключа и не внедрены модели."""
    if not getattr(request.app.state, "configured", False):
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED_DETAIL)


def safe_file_name(filename: str | None) -> str:
    """Basename only; quotes and square brackets are removed (they would break citation labels)."""
    # Browsers and httpx percent-encode a double quote in multipart file names as %22.
    # Control characters arrive percent-encoded (%09, %0A, ...) from browsers and httpx.
    # macOS sends names in NFD ("й" as "и" + combining breve); NFC keeps names comparable and citations stable.
    filename = unicodedata.normalize("NFC", filename or "")
    filename = _PCT_CONTROL_RE.sub("", filename)
    name = Path((filename).replace("%22", '"').replace("\\", "/")).name
    name = name.translate(_REMOVED_NAME_CHARS)
    return "".join(c for c in name if not unicodedata.category(c).startswith("C")).strip()


def _read_limited(upload: UploadFile, limit: int) -> bytes | None:
    """Whole content, or None if it is larger than `limit` bytes (stops reading early)."""
    data = bytearray()
    while chunk := upload.file.read(_CHUNK):
        data += chunk
        if len(data) > limit:
            return None
    return bytes(data)


def _rollback_index(settings: Settings, store: DocumentStore, name: str, final_path: Path, had_previous: bool) -> None:
    """Best effort: make the index match the disk again after a failed move."""
    try:
        if had_previous:
            store.add(name, load_and_split(final_path, name, settings.chunk_size, settings.chunk_overlap))
        else:
            store.delete(name)
    except Exception:
        logger.exception("Не удалось откатить индекс документа %s после ошибки сохранения файла", name)


def _ingest(request: Request, upload: UploadFile) -> dict[str, object]:
    settings: Settings = request.app.state.settings
    store: DocumentStore = request.app.state.store

    name = safe_file_name(upload.filename)
    suffix = Path(name).suffix.lower()
    if not name or suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, str(UnsupportedFormatError(name or (upload.filename or ""))))

    if len(name.encode("utf-8")) > MAX_NAME_BYTES:
        raise HTTPException(400, f"Слишком длинное имя файла {name[:50]}...: максимум {MAX_NAME_BYTES} байт")

    data = _read_limited(upload, settings.max_upload_mb * 1024 * 1024)
    if data is None:
        raise HTTPException(413, f"Файл {name} больше {settings.max_upload_mb} МБ")

    # Parse from a temporary file and move it into uploads only after the index is updated.
    # A parse or embedding failure leaves the previous copy (file and index) untouched; if the final
    # move fails, the index is rolled back to match what is on disk (removed, or rebuilt from the old file).
    final_path = settings.uploads_dir / name
    had_previous = final_path.exists()
    with tempfile.TemporaryDirectory(dir=settings.data_dir) as tmp:
        tmp_path = Path(tmp) / f"upload{suffix}"
        tmp_path.write_bytes(data)
        try:
            chunks = load_and_split(tmp_path, name, settings.chunk_size, settings.chunk_overlap)
        except IngestionError as exc:
            raise HTTPException(400, str(exc)) from exc
        try:
            count = store.add(name, chunks)
        except Exception as exc:
            status, detail = classify_llm_error(exc)
            raise HTTPException(status, detail) from exc
        try:
            os.replace(tmp_path, final_path)
        except OSError as exc:
            _rollback_index(settings, store, name, final_path, had_previous)
            raise HTTPException(400, f"Не удалось сохранить файл {name}") from exc
    return {"name": name, "chunks": count}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    app.state.store = None
    app.state.agent = None
    if not app.state.configured:
        yield
        return
    store = DocumentStore(
        settings.chroma_dir,
        app.state.embeddings,
        candidates=settings.retrieval_candidates,
        bm25_weight=settings.bm25_weight,
    )
    async with AsyncSqliteSaver.from_conn_string(str(settings.checkpoints_path)) as checkpointer:
        app.state.store = store
        app.state.agent = build_agent(app.state.chat_model, store, settings.search_k, checkpointer)
        yield


def create_app(
    settings: Settings | None = None,
    *,
    embeddings: Embeddings | None = None,
    chat_model: BaseChatModel | None = None,
) -> FastAPI:
    settings = settings or Settings()
    for directory in (settings.data_dir, settings.uploads_dir, settings.chroma_dir):
        directory.mkdir(parents=True, exist_ok=True)

    if settings.google_api_key:
        if embeddings is None:
            from langchain_google_genai import GoogleGenerativeAIEmbeddings

            embeddings = GoogleGenerativeAIEmbeddings(
                model=settings.embedding_model,
                google_api_key=settings.google_api_key,
            )
        if chat_model is None:
            from langchain_google_genai import ChatGoogleGenerativeAI

            chat_model = ChatGoogleGenerativeAI(
                model=settings.chat_model,
                google_api_key=settings.google_api_key,
            )

    app = FastAPI(title="Documentation RAG", lifespan=lifespan)
    app.state.settings = settings
    app.state.embeddings = embeddings
    app.state.chat_model = chat_model
    app.state.configured = embeddings is not None and chat_model is not None

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    api = APIRouter(prefix="/api", dependencies=[Depends(require_configured)])

    # Sync endpoints run in a threadpool, so PDF parsing and embedding do not block the event loop.
    @api.get("/documents")
    def list_documents(request: Request) -> dict[str, list[dict[str, object]]]:
        return {"documents": [{"name": d.name, "chunks": d.chunks} for d in request.app.state.store.list()]}

    @api.post("/documents")
    def upload_documents(request: Request, files: list[UploadFile]) -> dict[str, list[dict[str, object]]]:
        return {"documents": [_ingest(request, f) for f in files]}

    @api.delete("/documents/{name}", status_code=204)
    def delete_document(request: Request, name: str) -> Response:
        if not request.app.state.store.delete(name):
            raise HTTPException(404, f"Документ {name} не найден")
        (request.app.state.settings.uploads_dir / Path(name).name).unlink(missing_ok=True)
        return Response(status_code=204)

    @api.post("/chat")
    async def chat(request: Request, body: ChatRequest) -> EventSourceResponse:
        return EventSourceResponse(_sse_events(request.app.state.agent, body.thread_id, body.message))

    @api.get("/chat/{thread_id}/history")
    async def chat_history(
        request: Request, thread_id: Annotated[str, FastAPIPath(min_length=1, max_length=100)]
    ) -> dict[str, list[dict]]:
        return {"messages": await get_history(request.app.state.agent, thread_id)}

    app.include_router(api)
    return app


app = create_app()

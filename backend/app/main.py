import os
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, UploadFile
from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.agent import build_agent
from app.config import Settings
from app.errors import classify_llm_error
from app.ingestion import SUPPORTED_EXTENSIONS, IngestionError, UnsupportedFormatError, load_and_split
from app.vectorstore import DocumentStore

NOT_CONFIGURED_DETAIL = "Не задан GOOGLE_API_KEY"
_CHUNK = 1024 * 1024
_REMOVED_NAME_CHARS = str.maketrans("", "", '"[]')


def require_configured(request: Request) -> None:
    """Зависимость для всех /api/* роутов: 503, если нет ключа и не внедрены модели."""
    if not getattr(request.app.state, "configured", False):
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED_DETAIL)


def safe_file_name(filename: str | None) -> str:
    """Basename only; quotes and square brackets are removed (they would break citation labels)."""
    # Browsers and httpx percent-encode a double quote in multipart file names as %22.
    name = Path((filename or "").replace("%22", '"').replace("\\", "/")).name
    return name.translate(_REMOVED_NAME_CHARS).strip()


def _read_limited(upload: UploadFile, limit: int) -> bytes | None:
    """Whole content, or None if it is larger than `limit` bytes (stops reading early)."""
    data = bytearray()
    while chunk := upload.file.read(_CHUNK):
        data += chunk
        if len(data) > limit:
            return None
    return bytes(data)


def _ingest(request: Request, upload: UploadFile) -> dict[str, object]:
    settings: Settings = request.app.state.settings
    store: DocumentStore = request.app.state.store

    name = safe_file_name(upload.filename)
    suffix = Path(name).suffix.lower()
    if not name or suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, str(UnsupportedFormatError(name or (upload.filename or ""))))

    data = _read_limited(upload, settings.max_upload_mb * 1024 * 1024)
    if data is None:
        raise HTTPException(413, f"Файл {name} больше {settings.max_upload_mb} МБ")

    # Parse from a temporary file and move it into uploads only after the index is updated,
    # so a failure never leaves a stray file and never destroys a previous copy of the document.
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
        os.replace(tmp_path, settings.uploads_dir / name)
    return {"name": name, "chunks": count}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    app.state.store = None
    app.state.agent = None
    if not app.state.configured:
        yield
        return
    store = DocumentStore(settings.chroma_dir, app.state.embeddings)
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

    app.include_router(api)
    return app


app = create_app()

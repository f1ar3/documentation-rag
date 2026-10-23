from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel

from app.config import Settings

NOT_CONFIGURED_DETAIL = "Не задан GOOGLE_API_KEY"


def require_configured(request: Request) -> None:
    """Зависимость для всех /api/* роутов: 503, если нет ключа и не внедрены модели."""
    if not getattr(request.app.state, "configured", False):
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED_DETAIL)


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

    app = FastAPI(title="Documentation RAG")
    app.state.settings = settings
    app.state.embeddings = embeddings
    app.state.chat_model = chat_model
    app.state.configured = embeddings is not None and chat_model is not None

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    api = APIRouter(prefix="/api", dependencies=[Depends(require_configured)])

    @api.get("/documents")
    def list_documents() -> list:
        return []

    app.include_router(api)
    return app


app = create_app()

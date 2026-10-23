from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    google_api_key: str | None = None
    chat_model: str = "gemini-3.5-flash"
    embedding_model: str = "gemini-embedding-2-preview"
    data_dir: Path = Path("data")
    chunk_size: int = 1000
    chunk_overlap: int = 200
    search_k: int = 5
    max_upload_mb: int = 20

    @property
    def chroma_dir(self) -> Path:
        return self.data_dir / "chroma"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def checkpoints_path(self) -> Path:
        return self.data_dir / "checkpoints.sqlite"

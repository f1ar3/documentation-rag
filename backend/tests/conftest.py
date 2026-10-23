import pytest
from fastapi.testclient import TestClient
from langchain_core.embeddings import DeterministicFakeEmbedding

from app.config import Settings
from app.main import create_app
from tests.fakes import ScriptedChatModel


@pytest.fixture
def tmp_settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path, google_api_key=None, _env_file=None)


@pytest.fixture
def keyed_settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path, google_api_key="test-key", _env_file=None)


@pytest.fixture
def client(keyed_settings):
    app = create_app(
        keyed_settings,
        embeddings=DeterministicFakeEmbedding(size=64),
        chat_model=ScriptedChatModel(responses=[]),
    )
    with TestClient(app) as c:
        yield c

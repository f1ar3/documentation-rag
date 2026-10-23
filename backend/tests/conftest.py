import pytest

from app.config import Settings


@pytest.fixture
def tmp_settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path, google_api_key=None, _env_file=None)

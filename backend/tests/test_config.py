import pytest
from pydantic import ValidationError

from app.config import Settings


@pytest.mark.parametrize("kwargs", [{"bm25_weight": 1.5}, {"bm25_weight": -0.1}, {"retrieval_candidates": 0}])
def test_invalid_retrieval_settings(kwargs):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **kwargs)

from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok(tmp_settings):
    client = TestClient(create_app(tmp_settings))
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_api_without_key_returns_503(tmp_settings):
    client = TestClient(create_app(tmp_settings))
    resp = client.get("/api/documents")
    assert resp.status_code == 503
    assert resp.json()["detail"] == "Не задан GOOGLE_API_KEY"

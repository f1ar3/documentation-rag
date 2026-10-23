from langchain_core.embeddings import DeterministicFakeEmbedding
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import ScriptedChatModel, make_docx, make_pdf

LONG = "Сотрудник имеет право на ежегодный оплачиваемый отпуск продолжительностью двадцать восемь календарных дней. " * 3


def uploads(settings):
    return sorted(p.name for p in settings.uploads_dir.iterdir())


def post(client, *files):
    return client.post("/api/documents", files=[("files", f) for f in files])


def test_upload_each_format(client, tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", [LONG])
    docx = make_docx(tmp_path / "b.docx", [("h1", "Раздел"), ("p", LONG)])
    resp = post(
        client,
        ("a.pdf", pdf.read_bytes()),
        ("b.docx", docx.read_bytes()),
        ("c.md", ("# Заголовок\n\n" + LONG).encode()),
        ("d.txt", LONG.encode()),
    )
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    assert [d["name"] for d in docs] == ["a.pdf", "b.docx", "c.md", "d.txt"]
    assert all(d["chunks"] >= 1 for d in docs)


def test_upload_list_delete(client, keyed_settings, tmp_path):
    pdf = make_pdf(tmp_path / "regl.pdf", [LONG * 8, LONG * 8])
    resp = post(client, ("regl.pdf", pdf.read_bytes()))
    assert resp.status_code == 200
    assert resp.json()["documents"][0]["chunks"] >= 2
    assert "regl.pdf" in [d["name"] for d in client.get("/api/documents").json()["documents"]]
    assert client.delete("/api/documents/regl.pdf").status_code == 204
    assert client.get("/api/documents").json() == {"documents": []}
    assert uploads(keyed_settings) == []


def test_upload_path_traversal_and_cyrillic(client, keyed_settings, tmp_path):
    docx = make_docx(tmp_path / "x.docx", [("h1", "Отпуск"), ("p", LONG)])
    before = {p for p in tmp_path.rglob("*")}
    resp = post(client, ("../../evil/Положение об отпусках.docx", docx.read_bytes()))
    assert resp.status_code == 200
    assert resp.json()["documents"][0]["name"] == "Положение об отпусках.docx"
    assert uploads(keyed_settings) == ["Положение об отпусках.docx"]
    assert not (tmp_path.parent / "evil").exists()
    assert not (tmp_path / "evil").exists()
    assert all(p.is_relative_to(tmp_path) for p in tmp_path.rglob("*") if p not in before)


def test_upload_unsupported(client, keyed_settings):
    resp = post(client, ("old.doc", b"abc"), ("image.png", b"abc"))
    assert resp.status_code == 400
    assert "не поддерживается" in resp.json()["detail"]
    assert uploads(keyed_settings) == []
    resp = post(client, ("image.png", b"abc"))
    assert resp.status_code == 400
    assert uploads(keyed_settings) == []


def test_upload_scan_pdf(client, keyed_settings, tmp_path):
    pdf = make_pdf(tmp_path / "scan.pdf", [""])
    resp = post(client, ("scan.pdf", pdf.read_bytes()))
    assert resp.status_code == 400
    assert "скан без текстового слоя" in resp.json()["detail"]
    assert client.get("/api/documents").json() == {"documents": []}
    assert uploads(keyed_settings) == []


def test_upload_too_large(tmp_path):
    settings = Settings(data_dir=tmp_path, google_api_key="k", max_upload_mb=1, _env_file=None)
    app = create_app(settings, embeddings=DeterministicFakeEmbedding(size=64), chat_model=ScriptedChatModel(responses=[]))
    with TestClient(app) as c:
        resp = post(c, ("big.txt", b"a" * int(1.5 * 1024 * 1024)))
    assert resp.status_code == 413
    assert resp.json()["detail"] == "Файл big.txt больше 1 МБ"
    assert uploads(settings) == []


def test_delete_unknown(client):
    resp = client.delete("/api/documents/nope.pdf")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Документ nope.pdf не найден"


def test_upload_name_with_comma_kept(client, tmp_path):
    pdf = make_pdf(tmp_path / "p.pdf", [LONG])
    resp = post(client, ("Положение, ред. 2.pdf", pdf.read_bytes()))
    assert resp.status_code == 200
    assert resp.json()["documents"][0]["name"] == "Положение, ред. 2.pdf"


def test_upload_name_sanitized(client, keyed_settings):
    resp = post(client, ('"a[1].txt', LONG.encode()))
    assert resp.status_code == 200
    assert resp.json()["documents"][0]["name"] == "a1.txt"
    assert uploads(keyed_settings) == ["a1.txt"]


def test_failed_reupload_keeps_previous_file(client, keyed_settings, tmp_path):
    assert post(client, ("a.pdf", make_pdf(tmp_path / "a.pdf", [LONG]).read_bytes())).status_code == 200
    bad = post(client, ("a.pdf", make_pdf(tmp_path / "s.pdf", [""]).read_bytes()))
    assert bad.status_code == 400
    assert uploads(keyed_settings) == ["a.pdf"]
    assert [d["name"] for d in client.get("/api/documents").json()["documents"]] == ["a.pdf"]


def test_embedding_error_is_classified(keyed_settings):
    class Boom(DeterministicFakeEmbedding):
        def embed_documents(self, texts):
            raise RuntimeError("secret trace")

    app = create_app(keyed_settings, embeddings=Boom(size=64), chat_model=ScriptedChatModel(responses=[]))
    with TestClient(app) as c:
        resp = post(c, ("a.txt", LONG.encode()))
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Ошибка обращения к Gemini API: RuntimeError"
    assert uploads(keyed_settings) == []


def test_app_state_populated(client):
    assert client.app.state.store is not None
    assert client.app.state.agent is not None
    assert client.app.state.settings is not None

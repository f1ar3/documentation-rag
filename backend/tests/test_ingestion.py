import pytest

from app.ingestion import IngestionError, UnsupportedFormatError, load_and_split
from tests.fakes import make_docx, make_pdf

SIZE, OVERLAP = 1000, 200


def split(path, name=None):
    return load_and_split(path, name or path.name, SIZE, OVERLAP)


def test_pdf_pages_are_one_based(tmp_path):
    p = make_pdf(tmp_path / "test.pdf", ["Пункт 1. Отпуск 28 дней.", "Пункт 2. Командировка."])
    chunks = split(p)
    first = next(c for c in chunks if "28 дней" in c.page_content)
    second = next(c for c in chunks if "Командировка" in c.page_content)
    assert first.metadata["page"] == 1
    assert second.metadata["page"] == 2
    assert first.metadata["section"] is None
    assert first.metadata["source"] == "test.pdf"
    assert set(first.metadata) == {"source", "page", "section", "chunk_index"}


def test_long_text_split_with_overlap(tmp_path):
    text = " ".join(f"слово{i}" for i in range(450))
    p = make_pdf(tmp_path / "long.pdf", [text])
    chunks = split(p)
    assert len(chunks) >= 3
    assert all(len(c.page_content) <= 1000 for c in chunks)
    assert [c.metadata["chunk_index"] for c in chunks] == list(range(len(chunks)))


def test_docx_sections_and_table(tmp_path):
    p = make_docx(
        tmp_path / "t.docx",
        [
            ("h1", "1. Общие положения"),
            ("p", "Текст."),
            ("h1", "3. Суточные"),
            ("table", "Город|Сумма;Москва|1500 руб."),
        ],
    )
    chunks = split(p)
    c = next(c for c in chunks if "1500 руб." in c.page_content)
    assert c.metadata["section"] == "3. Суточные"
    assert c.metadata["page"] is None
    assert c.page_content.startswith("3. Суточные")
    assert "Москва | 1500 руб." in c.page_content


def test_docx_without_headings(tmp_path):
    p = make_docx(tmp_path / "t.docx", [("p", "Просто текст."), ("p", "Ещё абзац.")])
    chunks = split(p)
    assert chunks
    assert all(c.metadata["section"] is None for c in chunks)


def test_docx_heading_levels_use_latest_heading(tmp_path):
    p = make_docx(
        tmp_path / "t.docx",
        [("h1", "Раздел"), ("h2", "Подраздел"), ("p", "Содержимое.")],
    )
    c = split(p)[0]
    assert c.metadata["section"] == "Подраздел"


def test_md_sections(tmp_path):
    p = tmp_path / "a.md"
    p.write_text("# Удалёнка\n## Оборудование\nНоутбук выдаётся.\n", encoding="utf-8")
    chunks = split(p)
    c = next(c for c in chunks if "Ноутбук" in c.page_content)
    assert c.metadata["section"] == "Оборудование"
    assert c.metadata["page"] is None
    assert c.page_content == "Оборудование\nНоутбук выдаётся."


def test_heading_with_quotes_normalized(tmp_path):
    p = tmp_path / "a.md"
    p.write_text('## Правило "чистого стола" [v2]\nУбирайте стол.\n', encoding="utf-8")
    c = split(p)[0]
    assert c.metadata["section"] == "Правило 'чистого стола' v2"


def test_md_long_section_chunks_fit_with_prefix(tmp_path):
    body = " ".join(f"слово{i}" for i in range(400))
    p = tmp_path / "a.md"
    p.write_text(f"# Большой раздел\n{body}\n", encoding="utf-8")
    chunks = split(p)
    assert len(chunks) >= 2
    assert all(len(c.page_content) <= 1000 for c in chunks)
    assert all(c.page_content.startswith("Большой раздел\n") for c in chunks)
    assert [c.metadata["chunk_index"] for c in chunks] == list(range(len(chunks)))


@pytest.mark.parametrize("encoding", ["utf-8", "cp1251"])
def test_txt_utf8_and_cp1251(tmp_path, encoding):
    phrase = "Отпуск предоставляется на 28 календарных дней"
    p = tmp_path / "faq.txt"
    p.write_bytes(phrase.encode(encoding))
    chunks = split(p)
    assert phrase in chunks[0].page_content
    assert chunks[0].metadata["page"] is None and chunks[0].metadata["section"] is None


def test_extension_is_case_insensitive(tmp_path):
    p = tmp_path / "x.TXT"
    p.write_text("Привет, мир", encoding="utf-8")
    assert split(p)


def test_unsupported_extension(tmp_path):
    p = tmp_path / "notes.doc"
    p.write_bytes(b"x")
    with pytest.raises(UnsupportedFormatError) as e:
        split(p)
    assert "PDF, DOCX, MD, TXT" in str(e.value)
    assert isinstance(e.value, IngestionError)


def _pdf_blank(tmp_path):
    return make_pdf(tmp_path / "scan.pdf", [""])


def _raw(name, data):
    def build(tmp_path):
        p = tmp_path / name
        p.write_bytes(data)
        return p

    return build


@pytest.mark.parametrize(
    "build",
    [
        _pdf_blank,
        _raw("bad.pdf", b"not a pdf"),
        _raw("bad.docx", b"garbage"),
        _raw("empty.txt", b""),
        _raw("bin.txt", b"\x00\x01"),
        _raw("empty.md", b"  \n"),
    ],
)
def test_empty_inputs_raise(tmp_path, build):
    p = build(tmp_path)
    with pytest.raises(IngestionError) as e:
        split(p)
    assert p.name in str(e.value)
    assert "Не удалось извлечь текст" in str(e.value)

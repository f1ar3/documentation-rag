import re
from pathlib import Path

from docx import Document
from pypdf import PdfReader

from app.ingestion import load_and_split

SAMPLE = Path(__file__).resolve().parents[2] / "sample_docs"
CYR = re.compile("[А-Яа-яЁё]")
FILES = [
    "otpuska.pdf",
    "informacionnaya-bezopasnost.pdf",
    "komandirovki.docx",
    "udalennaya-rabota.md",
    "faq-novichkam.txt",
]


def test_sample_docs_exist():
    for name in FILES:
        assert (SAMPLE / name).is_file(), name
    assert (SAMPLE / "FACTS.md").is_file()


def test_pdfs_have_3_to_6_pages_with_cyrillic():
    for name in ("otpuska.pdf", "informacionnaya-bezopasnost.pdf"):
        reader = PdfReader(str(SAMPLE / name))
        assert 3 <= len(reader.pages) <= 6, name
        for i, page in enumerate(reader.pages, 1):
            assert CYR.search(page.extract_text() or ""), f"{name} page {i}"


def test_docx_has_table_and_headings():
    doc = Document(str(SAMPLE / "komandirovki.docx"))
    assert len(doc.tables) >= 1
    headings = [p for p in doc.paragraphs if p.style.name.startswith("Heading")]
    assert len(headings) >= 2


def test_md_has_headings():
    lines = (SAMPLE / "udalennaya-rabota.md").read_text(encoding="utf-8").splitlines()
    assert any(l.startswith("# ") for l in lines)
    assert any(l.startswith("## ") for l in lines)


def test_txt_is_utf8_cyrillic_without_headings():
    text = (SAMPLE / "faq-novichkam.txt").read_text(encoding="utf-8")
    assert CYR.search(text)


def test_no_dashes_and_facts_file():
    for name in FILES + ["FACTS.md"]:
        p = SAMPLE / name
        if p.suffix in (".md", ".txt"):
            t = p.read_text(encoding="utf-8")
            assert "—" not in t and "–" not in t, name


def test_facts_sections_are_real_headings():
    doc = Document(str(SAMPLE / "komandirovki.docx"))
    docx_headings = {p.text.strip() for p in doc.paragraphs if p.style.name.startswith("Heading")}
    md_headings = {
        l.lstrip("#").strip()
        for l in (SAMPLE / "udalennaya-rabota.md").read_text(encoding="utf-8").splitlines()
        if l.startswith("#")
    }
    checked = 0
    for line in (SAMPLE / "FACTS.md").read_text(encoding="utf-8").splitlines():
        if not line.startswith("| ") or line.startswith("| №"):
            continue
        cols = [c.strip() for c in line.strip("|").split("|")]
        fname, section = cols[3], cols[4]
        if fname == "komandirovki.docx":
            assert section in docx_headings, section
            checked += 1
        elif fname == "udalennaya-rabota.md":
            assert section in md_headings, section
            checked += 1
    assert checked >= 10


def test_sample_docs_ingest():
    for name in FILES:
        chunks = load_and_split(SAMPLE / name, name, 1000, 200)
        assert chunks, name
        if name.endswith(".pdf"):
            assert all(c.metadata["page"] >= 1 for c in chunks), name
        if name in ("komandirovki.docx", "udalennaya-rabota.md"):
            assert any(c.metadata["section"] for c in chunks), name

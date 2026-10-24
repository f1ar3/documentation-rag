from dataclasses import dataclass
from pathlib import Path

from docx import Document as DocxDocument
from docx.table import Table
from docx.text.paragraph import Paragraph
from langchain_community.document_loaders import PyPDFLoader
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

SUPPORTED_EXTENSIONS: frozenset[str] = frozenset({".pdf", ".docx", ".md", ".txt"})

_MIN_BODY_SIZE = 50


class IngestionError(ValueError):
    """Message is ready to be shown to the user."""


class UnsupportedFormatError(IngestionError):
    def __init__(self, source_name: str):
        super().__init__(
            f"Формат файла {source_name} не поддерживается. Допустимы: PDF, DOCX, MD, TXT"
        )


def _empty_error(source_name: str) -> IngestionError:
    return IngestionError(
        f"Не удалось извлечь текст из {source_name}: "
        "файл пустой, повреждён или это скан без текстового слоя"
    )


def normalize_heading(title: str) -> str:
    return title.replace('"', "'").replace("[", "").replace("]", "").strip()


@dataclass(frozen=True)
class DocumentPart:
    """A page (PDF) or a section (DOCX/MD) of a document in reading order, before chunking."""

    page: int | None
    section: str | None
    text: str


def _read_pdf(path: Path, source_name: str) -> list[DocumentPart]:
    try:
        pages = PyPDFLoader(str(path)).load()
    except Exception as exc:
        raise _empty_error(source_name) from exc
    return [
        DocumentPart(page=int(d.metadata.get("page", 0)) + 1, section=None, text=d.page_content)
        for d in pages
        if d.page_content.strip()
    ]


def _is_heading(paragraph: Paragraph) -> bool:
    style = paragraph.style.name if paragraph.style is not None else ""
    return style.startswith(("Heading", "Заголовок"))


def _read_docx(path: Path, source_name: str) -> list[DocumentPart]:
    try:
        doc = DocxDocument(str(path))
        body = doc.element.body
        parts: list[DocumentPart] = []
        section: str | None = None
        lines: list[str] = []

        def flush() -> None:
            text = "\n".join(lines).strip()
            if text:
                parts.append(DocumentPart(page=None, section=section, text=text))
            lines.clear()

        for child in body.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                paragraph = Paragraph(child, doc)
                text = paragraph.text.strip()
                if _is_heading(paragraph):
                    flush()
                    section = normalize_heading(text) or None
                elif text:
                    lines.append(text)
            elif tag == "tbl":
                table = Table(child, doc)
                for row in table.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if any(cells):
                        lines.append(" | ".join(cells))
        flush()
        return parts
    except Exception as exc:
        raise _empty_error(source_name) from exc


_MD_HEADING_MARKS = ("### ", "## ", "# ")
_MD_FENCES = ("```", "~~~")


def _md_heading(line: str) -> str | None:
    """Title of a level 1-3 ATX heading, or None. Deeper headings stay in the body text."""
    stripped = line.strip()
    for mark in _MD_HEADING_MARKS:
        if stripped.startswith(mark) or stripped == mark.strip():
            return stripped[len(mark):].strip()
    return None


def _read_md(path: Path, source_name: str) -> list[DocumentPart]:
    """Split by level 1-3 headings; the section is the latest heading. Body lines are kept verbatim
    (blank lines, indentation), so the text renders as the original Markdown."""
    try:
        text = _decode(path.read_bytes())
    except Exception as exc:
        raise _empty_error(source_name) from exc
    parts: list[DocumentPart] = []
    section: str | None = None
    lines: list[str] = []
    fence: str | None = None

    def flush() -> None:
        body = "\n".join(lines).strip()
        if body:
            parts.append(DocumentPart(page=None, section=section, text=body))
        lines.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if fence is None:
            heading = _md_heading(line)
            if heading is not None:
                flush()
                section = normalize_heading(heading) or None
                continue
            fence = next((f for f in _MD_FENCES if stripped.startswith(f)), None)
        elif stripped.startswith(fence):
            fence = None
        lines.append(line)
    flush()
    return parts


def _decode(data: bytes) -> str:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1251")
    if "\x00" in text:
        raise ValueError("binary file")
    return text


def _read_txt(path: Path, source_name: str) -> list[DocumentPart]:
    try:
        text = _decode(path.read_bytes())
    except Exception as exc:
        raise _empty_error(source_name) from exc
    return [DocumentPart(page=None, section=None, text=text)] if text.strip() else []


_READERS = {
    ".pdf": _read_pdf,
    ".docx": _read_docx,
    ".md": _read_md,
    ".txt": _read_txt,
}


def _split_part(
    text: str, section: str | None, chunk_size: int, chunk_overlap: int
) -> list[str]:
    """Split body text so that the final chunk (with section prefix) fits chunk_size."""
    prefix = f"{section}\n" if section else ""
    size = max(chunk_size - len(prefix), _MIN_BODY_SIZE)
    overlap = min(chunk_overlap, size // 4) if size < chunk_size else chunk_overlap
    splitter = RecursiveCharacterTextSplitter(chunk_size=size, chunk_overlap=overlap)
    return [prefix + piece for piece in splitter.split_text(text) if piece.strip()]


def extract_parts(path: Path, source_name: str) -> list[DocumentPart]:
    """Readable parts of the document in reading order; the format is taken from `source_name`."""
    suffix = Path(source_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise UnsupportedFormatError(source_name)
    parts = [p for p in _READERS[suffix](path, source_name) if p.text.strip()]
    if not parts:
        raise _empty_error(source_name)
    return parts


def load_and_split(
    path: Path, source_name: str, chunk_size: int, chunk_overlap: int
) -> list[Document]:
    chunks: list[Document] = []
    for part in extract_parts(path, source_name):
        for content in _split_part(part.text, part.section, chunk_size, chunk_overlap):
            chunks.append(
                Document(
                    page_content=content,
                    metadata={
                        "source": source_name,
                        "page": part.page,
                        "section": part.section,
                        "chunk_index": len(chunks),
                    },
                )
            )
    if not chunks:
        raise _empty_error(source_name)
    return chunks

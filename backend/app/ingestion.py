from pathlib import Path

from docx import Document as DocxDocument
from docx.table import Table
from docx.text.paragraph import Paragraph
from langchain_community.document_loaders import PyPDFLoader
from langchain_core.documents import Document
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

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


# A raw part is (text, page, section) before splitting.
_Part = tuple[str, int | None, str | None]


def _read_pdf(path: Path, source_name: str) -> list[_Part]:
    try:
        pages = PyPDFLoader(str(path)).load()
    except Exception as exc:
        raise _empty_error(source_name) from exc
    return [
        (d.page_content, int(d.metadata.get("page", 0)) + 1, None)
        for d in pages
        if d.page_content.strip()
    ]


def _is_heading(paragraph: Paragraph) -> bool:
    style = paragraph.style.name if paragraph.style is not None else ""
    return style.startswith(("Heading", "Заголовок"))


def _read_docx(path: Path, source_name: str) -> list[_Part]:
    try:
        doc = DocxDocument(str(path))
        body = doc.element.body
        parts: list[_Part] = []
        section: str | None = None
        lines: list[str] = []

        def flush() -> None:
            text = "\n".join(lines).strip()
            if text:
                parts.append((text, None, section))
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


def _read_md(path: Path, source_name: str) -> list[_Part]:
    try:
        text = _decode(path.read_bytes())
    except Exception as exc:
        raise _empty_error(source_name) from exc
    splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=[("#", "h1"), ("##", "h2"), ("###", "h3")]
    )
    parts: list[_Part] = []
    for d in splitter.split_text(text):
        content = d.page_content.strip()
        if not content:
            continue
        titles = [d.metadata[k] for k in ("h3", "h2", "h1") if d.metadata.get(k)]
        section = normalize_heading(titles[0]) if titles else None
        parts.append((content, None, section or None))
    return parts


def _decode(data: bytes) -> str:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1251")
    if "\x00" in text:
        raise ValueError("binary file")
    return text


def _read_txt(path: Path, source_name: str) -> list[_Part]:
    try:
        text = _decode(path.read_bytes())
    except Exception as exc:
        raise _empty_error(source_name) from exc
    return [(text, None, None)] if text.strip() else []


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


def load_and_split(
    path: Path, source_name: str, chunk_size: int, chunk_overlap: int
) -> list[Document]:
    suffix = Path(source_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise UnsupportedFormatError(source_name)

    parts = _READERS[suffix](path, source_name)

    chunks: list[Document] = []
    for text, page, section in parts:
        for content in _split_part(text, section, chunk_size, chunk_overlap):
            chunks.append(
                Document(
                    page_content=content,
                    metadata={
                        "source": source_name,
                        "page": page,
                        "section": section,
                        "chunk_index": len(chunks),
                    },
                )
            )
    if not chunks:
        raise _empty_error(source_name)
    return chunks

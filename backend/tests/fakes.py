from pathlib import Path

from docx import Document as DocxDocument
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "fonts" / "DejaVuSans.ttf"
_FONT_NAME = "DejaVuSans"


def make_pdf(path: Path, pages: list[str]) -> Path:
    """PDF with one page per item; an empty string gives a page without text."""
    if _FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(_FONT_NAME, str(FONT_PATH)))
    c = canvas.Canvas(str(path))
    for text in pages:
        if text:
            c.setFont(_FONT_NAME, 10)
            y = 800
            line = ""
            for word in text.split(" "):
                candidate = f"{line} {word}".strip()
                if len(candidate) > 90:
                    c.drawString(40, y, line)
                    y -= 14
                    line = word
                else:
                    line = candidate
            if line:
                c.drawString(40, y, line)
        c.showPage()
    c.save()
    return path


def make_docx(path: Path, blocks: list[tuple[str, str]]) -> Path:
    """Blocks: ("h1" | "h2" | "p", text) or ("table", "a|b;c|d")."""
    doc = DocxDocument()
    for kind, text in blocks:
        if kind == "h1":
            doc.add_heading(text, level=1)
        elif kind == "h2":
            doc.add_heading(text, level=2)
        elif kind == "p":
            doc.add_paragraph(text)
        elif kind == "table":
            rows = [r.split("|") for r in text.split(";")]
            table = doc.add_table(rows=len(rows), cols=len(rows[0]))
            for i, row in enumerate(rows):
                for j, cell in enumerate(row):
                    table.cell(i, j).text = cell
        else:
            raise ValueError(f"unknown block kind: {kind}")
    doc.save(str(path))
    return path

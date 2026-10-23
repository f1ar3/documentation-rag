from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.citations import CITATION_RE, Source, extract_sources, format_label, found_sources_for_turn, parse_citation


def src(source: str, page: int | None = None, section: str | None = None) -> Source:
    return {"source": source, "page": page, "section": section}


def test_extract_keeps_only_found():
    answer = "Отпуск 28 дней [otpuska.pdf, стр. 2]. Выдумка [otpuska.pdf, стр. 9]. Ещё [fake.pdf, стр. 1]."
    found = [src("otpuska.pdf", 2)]
    assert extract_sources(answer, found) == [src("otpuska.pdf", 2)]


def test_extract_all_three_forms():
    answer = (
        'Суточные 700 руб. [komandirovki.docx, раздел "3. Суточные"]. '
        "Пропуск выдают в первый день [faq-novichkam.txt]. "
        "Отпуск 28 дней [otpuska.PDF, стр. 1]. "
        'Выдумка [komandirovki.docx, раздел "Выдуманный"].'
    )
    found = [
        src("otpuska.PDF", 1),
        src("komandirovki.docx", section="3. Суточные"),
        src("faq-novichkam.txt"),
    ]
    assert extract_sources(answer, found) == [
        src("komandirovki.docx", section="3. Суточные"),
        src("faq-novichkam.txt"),
        src("otpuska.PDF", 1),
    ]


def test_format_label_roundtrip():
    for s in (src("otpuska.pdf", 3), src("komandirovki.docx", section="3. Суточные"), src("faq.txt")):
        assert parse_citation(CITATION_RE.search(format_label(s))) == s


def test_format_label_exact_forms():
    assert format_label(src("otpuska.pdf", 3)) == "[otpuska.pdf, стр. 3]"
    assert format_label(src("komandirovki.docx", section="3. Суточные")) == '[komandirovki.docx, раздел "3. Суточные"]'
    assert format_label(src("faq.txt")) == "[faq.txt]"


def test_extract_cyrillic_name_and_dedupe():
    answer = (
        "Первое [Положение об отпусках.pdf, стр. 3]. Второе [Положение об отпусках.pdf, стр. 3]. "
        "Третье [Положение об отпусках.pdf, стр.1]."
    )
    found = [src("Положение об отпусках.pdf", 1), src("Положение об отпусках.pdf", 3)]
    assert extract_sources(answer, found) == [
        src("Положение об отпусках.pdf", 3),
        src("Положение об отпусках.pdf", 1),
    ]


def test_regex_ignores_arbitrary_brackets():
    text = "Обычный [просто текст в скобках] и [файл.exe] и [doc.md, что-то ещё]"
    assert CITATION_RE.search(text) is None


def test_no_citations_returns_empty():
    assert extract_sources("В загруженных документах нет ответа на этот вопрос", [src("a.pdf", 1)]) == []


def test_found_sources_only_current_turn():
    a = src("a.pdf", 1)
    b = src("b.md", section="Оборудование")
    messages = [
        HumanMessage("первый"),
        ToolMessage("...", tool_call_id="1", name="search_documents", artifact=[a]),
        AIMessage("ответ [a.pdf, стр. 1]"),
        HumanMessage("второй"),
        ToolMessage("...", tool_call_id="2", name="search_documents", artifact=[b]),
        ToolMessage("...", tool_call_id="3", name="search_documents", artifact=[b, a]),
        ToolMessage("- a.pdf (1 фрагм.)", tool_call_id="4", name="list_documents"),
        AIMessage('ответ [b.md, раздел "Оборудование"]'),
    ]
    assert found_sources_for_turn(messages) == [b, a]


def test_extract_sources_file_name_with_comma():
    found = [{"source": "Положение, ред. 2.pdf", "page": 1, "section": None}]
    answer = "Ответ [Положение, ред. 2.pdf, стр. 1]"
    assert extract_sources(answer, found) == found

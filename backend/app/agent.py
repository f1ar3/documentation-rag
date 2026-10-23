from __future__ import annotations

from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool, tool
from langgraph.checkpoint.base import BaseCheckpointSaver

from app.citations import SEARCH_TOOL_NAME, Source, format_label
from app.vectorstore import DocumentStore

NO_ANSWER = "В загруженных документах нет ответа на этот вопрос"
EMPTY_STORE = "База документов пуста. Загрузите регламенты (PDF, DOCX, MD, TXT)."
NOTHING_FOUND = "Ничего не найдено."
NO_DOCUMENTS = "Документы не загружены."
FRAGMENT_SEPARATOR = "\n\n---\n\n"

SYSTEM_PROMPT = f"""Ты - ассистент по внутренним регламентам компании. Ты отвечаешь сотрудникам на вопросы по загруженным документам.

Правила:
1. Для любого вопроса по содержанию регламентов сначала вызови инструмент {SEARCH_TOOL_NAME}. Если найденного недостаточно, вызови его ещё раз с другой формулировкой запроса (синонимы, более общий или более узкий запрос).
2. Отвечай только на основе найденных фрагментов. Ничего не придумывай и не используй знания со стороны.
3. После каждого утверждения ставь метку источника. Метку копируй дословно из заголовка фрагмента, на котором основано утверждение, например [otpuska.pdf, стр. 3], [komandirovki.docx, раздел "3. Суточные"] или [faq.txt]. Не меняй и не сокращай метки, не придумывай новые.
4. Если в найденных фрагментах нет ответа, ответь ровно: "{NO_ANSWER}" и не ставь никаких меток.
5. На приветствия, благодарности и вопросы о самом диалоге (например, что спрашивали раньше) отвечай без поиска и без меток.
6. Если спрашивают, какие документы загружены, вызови инструмент list_documents.

Отвечай на русском языке, кратко и по делу."""


def make_tools(store: DocumentStore, k: int) -> list[BaseTool]:
    @tool(SEARCH_TOOL_NAME, response_format="content_and_artifact")
    def search_documents(query: str) -> tuple[str, list[Source]]:
        """Ищет фрагменты внутренних регламентов, относящиеся к запросу. Каждый фрагмент начинается с метки источника."""
        hits = store.search(query, k)
        if not hits:
            return (NOTHING_FOUND if store.list() else EMPTY_STORE), []
        sources: list[Source] = []
        fragments: list[str] = []
        for hit in hits:
            src: Source = {"source": hit.source, "page": hit.page, "section": hit.section}
            fragments.append(f"{format_label(src)}\n{hit.text}")
            if src not in sources:
                sources.append(src)
        return FRAGMENT_SEPARATOR.join(fragments), sources

    @tool
    def list_documents() -> str:
        """Возвращает список загруженных документов с количеством фрагментов."""
        docs = store.list()
        if not docs:
            return NO_DOCUMENTS
        return "\n".join(f"- {d.name} ({d.chunks} фрагм.)" for d in docs)

    return [search_documents, list_documents]


def build_agent(model: BaseChatModel, store: DocumentStore, k: int, checkpointer: BaseCheckpointSaver):
    return create_agent(model, tools=make_tools(store, k), system_prompt=SYSTEM_PROMPT, checkpointer=checkpointer)

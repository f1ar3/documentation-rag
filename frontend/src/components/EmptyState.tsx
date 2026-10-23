const EXAMPLE_QUESTIONS = [
  'Сколько дней ежегодного отпуска положено?',
  'За сколько дней подавать заявление на отпуск?',
  'Какой минимальной длины должен быть пароль?',
  'Какие документы загружены?',
]

export function EmptyState({ onPick }: { onPick(question: string): void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto w-full max-w-[720px] px-4 py-10 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
          Чем могу помочь?
        </h1>
        <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
          Отвечаю на вопросы по загруженным регламентам компании и указываю, на какой документ и
          страницу опирается ответ.
        </p>
        <ul className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Примеры вопросов">
          {EXAMPLE_QUESTIONS.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => onPick(q)}
                className="h-full w-full rounded-xl border bg-background px-4 py-3 text-left text-sm leading-snug text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

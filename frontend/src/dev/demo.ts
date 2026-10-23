// Dev-only mock data for `?demo=1` (visual checks without a backend).
// Imported dynamically behind `import.meta.env.DEV`, so it is not part of the production bundle.
import type { DocumentInfo } from '@/lib/types'
import type { UiMessage } from '@/state/chat'

export const demoDocuments: DocumentInfo[] = [
  { name: 'otpuska.pdf', chunks: 12 },
  { name: 'komandirovki.docx', chunks: 8 },
  { name: 'it-bezopasnost.md', chunks: 5 },
  { name: 'faq.txt', chunks: 3 },
]

export const demoMessages: UiMessage[] = [
  { id: 'd1', role: 'user', content: 'Сколько дней ежегодного отпуска положено?', sources: [], status: 'done' },
  {
    id: 'd2',
    role: 'assistant',
    content:
      'Сотрудникам положен ежегодный оплачиваемый отпуск **28 календарных дней** [otpuska.pdf, стр. 1].\n\n' +
      'Отпуск можно делить на части, при этом:\n\n' +
      '- одна из частей должна быть не меньше 14 дней [otpuska.pdf, стр. 2];\n' +
      '- заявление подаётся не позднее чем за 14 дней до начала [otpuska.pdf, стр. 3].\n\n' +
      '| Категория | Дней |\n|---|---|\n| Основной отпуск | 28 |\n| Ненормированный день | +3 |\n\n' +
      'Дополнительные дни за ненормированный день описаны в положении о командировках [komandirovki.docx, раздел "3. Суточные"].',
    sources: [
      { source: 'otpuska.pdf', page: 1, section: null },
      { source: 'otpuska.pdf', page: 2, section: null },
      { source: 'otpuska.pdf', page: 3, section: null },
      { source: 'komandirovki.docx', page: null, section: '3. Суточные' },
    ],
    status: 'done',
  },
  { id: 'd3', role: 'user', content: 'Какой минимальной длины должен быть пароль?', sources: [], status: 'done' },
  {
    id: 'd4',
    role: 'assistant',
    content: 'Пароль должен содержать не менее 12 символов',
    sources: [],
    status: 'error',
    error: 'Превышен лимит запросов к Gemini API, попробуйте позже',
  },
  { id: 'd5', role: 'user', content: 'А что с командировками?', sources: [], status: 'done' },
  { id: 'd6', role: 'assistant', content: 'Суточные в командировке составляют 700 рублей [komandirovki.docx, раздел "3. Суточные"]', sources: [], status: 'streaming' },
]

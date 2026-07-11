// Structured questions a model can ask the user, Claude-Code-style. A model
// running on the gateway emits an `<ask>` block whose body is a small JSON object
// describing a question plus its selectable options; the chat UI lifts that out of
// the transcript and renders interactive buttons (see components/chat/QuestionCard).
// Clicking an option sends the chosen label back as the user's next turn.
//
// The `ask-user` native skill (electron/main → NATIVE_SKILLS) teaches models this
// format. This module is the pure, dependency-free parser so it's easy to test and
// shared between the streaming and final render paths.
//
// Wire format (JSON inside the tag):
//   <ask>
//   {
//     "question": "Which database should I use?",
//     "header": "Database",            // optional short chip label
//     "multiSelect": false,            // optional; default false
//     "options": [
//       { "label": "PostgreSQL", "description": "Relational, robust" },
//       { "label": "SQLite", "description": "Zero-config, file-based" }
//     ]
//   }
//   </ask>
//
// `options` may also be a plain string array (["Yes", "No"]). If omitted entirely
// the question is treated as a simple confirmation and defaults to Yes / No.

export interface AskOption {
  label: string
  description?: string
}

export interface AskQuestion {
  id: string            // stable within one message (position-based)
  question: string
  header?: string
  multiSelect: boolean
  options: AskOption[]
}

export interface ParsedAsk {
  questions: AskQuestion[]
  text: string          // the message content with complete <ask> blocks removed
}

const ASK_BLOCK_RE = /<ask\b[^>]*>([\s\S]*?)<\/ask>/gi
// A trailing <ask …> that hasn't been closed yet — used to hide partial JSON while
// the answer is still streaming in.
const UNCLOSED_ASK_RE = /<ask\b[^>]*>[\s\S]*$/i

const YES_NO: AskOption[] = [{ label: 'Yes' }, { label: 'No' }]

function normalizeOptions(raw: unknown): AskOption[] {
  if (!Array.isArray(raw)) return []
  const out: AskOption[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const label = item.trim()
      if (label) out.push({ label })
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const label = typeof o.label === 'string' ? o.label.trim()
        : typeof o.value === 'string' ? o.value.trim() : ''
      if (!label) continue
      const description = typeof o.description === 'string' && o.description.trim()
        ? o.description.trim() : undefined
      out.push({ label, description })
    }
  }
  return out
}

function parseOne(body: string, index: number): AskQuestion | null {
  let data: unknown
  try { data = JSON.parse(body.trim()) } catch { return null }
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>

  const question = typeof o.question === 'string' ? o.question.trim()
    : typeof o.prompt === 'string' ? o.prompt.trim() : ''
  if (!question) return null

  const header = typeof o.header === 'string' && o.header.trim() ? o.header.trim() : undefined
  const multiSelect = o.multiSelect === true || o.multi === true
  const options = normalizeOptions(o.options)

  return {
    id: `q${index}`,
    question,
    header,
    multiSelect,
    options: options.length ? options : YES_NO,
  }
}

/**
 * Extract `<ask>` question blocks from assistant content.
 *
 * Complete blocks are removed from `text` and returned as structured questions.
 * Malformed blocks (bad JSON / no question) are dropped silently so a model
 * mistake never leaks raw JSON into the transcript. While `streaming` is true, a
 * still-open trailing `<ask …>` is also hidden so partial JSON doesn't flash
 * before the closing tag arrives.
 */
export function parseAskBlocks(content: string, opts?: { streaming?: boolean }): ParsedAsk {
  const questions: AskQuestion[] = []
  let index = 0

  let text = content.replace(ASK_BLOCK_RE, (_full, body: string) => {
    const q = parseOne(body, index)
    if (!q) return ''
    questions.push(q)
    index++
    return ''
  })

  if (opts?.streaming) {
    text = text.replace(UNCLOSED_ASK_RE, '')
  }

  return { questions, text: text.trim() }
}

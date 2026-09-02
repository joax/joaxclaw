// Adopting the gateway's `ask_user` tool.
//
// JoaxClaw's own mechanism is an `<ask>` block in the message text (see askQuestion.ts).
// The gateway also exposes a real `ask_user` TOOL for the same job, and a model handed
// both will reach for the tool — that's what tools are for. Until now such a call
// rendered as a generic tool pill: the buttons never appeared, so from the user's side
// the feature simply didn't fire.
//
// This maps a tool call's arguments onto the same `AskQuestion` shape the `<ask>` parser
// produces, so both routes land on the same card and the model can use either.
//
// Deliberately tolerant about the argument shape. The tool's schema is the gateway's,
// not ours, and models get it wrong in predictable ways — the reported failure passed
// `questions` as a JSON-encoded *string* rather than an array. Anything we can read
// unambiguously, we accept; anything we can't, we return nothing for, and the call falls
// back to rendering as an ordinary tool pill rather than a card built on a guess.

import { normalizeOptions, YES_NO, type AskQuestion } from './askQuestion'
import type { ToolCall } from './types'

/** Tool names that mean "ask the user a structured question". */
const ASK_TOOL_RE = /^ask[_-]?user$/i

export function isAskUserTool(name: string): boolean {
  return ASK_TOOL_RE.test(name.trim())
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return undefined }
}

/** A value that should be an array but may arrive JSON-encoded as a string. */
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    const parsed = parseJson(v)
    if (Array.isArray(parsed)) return parsed
  }
  return []
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function toQuestion(raw: unknown, index: number, fallbackHeader?: string): AskQuestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  // `label` last: some shapes name the question itself `label`, but when `question` is
  // present `label` usually belongs to an option.
  const question = str(o.question) || str(o.prompt) || str(o.text) || str(o.label)
  if (!question) return null
  const header = str(o.header) || fallbackHeader || undefined
  const options = normalizeOptions(o.options ?? o.choices)
  return {
    id: `t${index}`,          // distinct from the `<ask>` parser's `q0`, `q1`, …
    question,
    ...(header ? { header } : {}),
    multiSelect: o.multiSelect === true || o.multi === true,
    options: options.length ? options : YES_NO,
  }
}

/**
 * Questions carried by one `ask_user` tool call, or `[]` when the arguments can't be
 * read as questions.
 */
export function questionsFromAskUserArgs(args: string | undefined): AskQuestion[] {
  if (!args) return []
  const data = parseJson(args)
  if (!data || typeof data !== 'object') return []
  const o = data as Record<string, unknown>
  const header = str(o.header) || undefined

  const list = asArray(o.questions)
  if (list.length) {
    return list.map((q, i) => toQuestion(q, i, header)).filter((q): q is AskQuestion => q !== null)
  }
  // Single-question form — the same body our own `<ask>` block uses.
  const one = toQuestion(o, 0, header)
  return one ? [one] : []
}

/**
 * Questions to render as cards for a message's tool calls.
 *
 * A FAILED call is skipped on purpose: nothing was asked, so showing live buttons would
 * invent an interaction that never happened. Those keep their ordinary tool pill, where
 * the error is visible.
 */
export function questionsFromToolCalls(calls: ToolCall[] | undefined): AskQuestion[] {
  if (!calls?.length) return []
  const out: AskQuestion[] = []
  for (const call of calls) {
    if (!isAskUserTool(call.name) || call.status === 'error') continue
    for (const q of questionsFromAskUserArgs(call.args)) {
      out.push({ ...q, id: `${call.id}:${q.id}` })
    }
  }
  return out
}

/** True when this call is an ask_user that rendered as a card, so the pill is redundant. */
export function renderedAsQuestionCard(call: ToolCall): boolean {
  return isAskUserTool(call.name) && call.status !== 'error' && questionsFromAskUserArgs(call.args).length > 0
}

// Structured questions the GATEWAY is holding open, as opposed to the ones JoaxClaw
// lifts out of the transcript itself (lib/askQuestion.ts).
//
// The difference matters. An `<ask>` block or an `ask_user` tool call is text inside a
// message, and this app answers it by sending the chosen label as an ordinary chat turn.
// A gateway question is a first-class record with its own id and lifecycle, and the
// agent is *parked* waiting on `question.resolve`. Answering one by chatting at it is
// what OpenClaw 2026.9's "recover lost answer confirmations without sending the same
// input through ordinary steering again" fix is about: the run is not listening to the
// transcript, it is listening for the resolve.
//
//   question.list    {}                                  -> { questions: QuestionRecord[] }
//   question.get     { id }
//   question.resolve { id, answers: { answers } } | { id, cancel: true }
//   events: question.requested / question.resolved
//
// All of them require the `operator.questions` scope, which `operator.write` does NOT
// imply — see lib/gateway.ts.

import type { AskOption, AskQuestion } from './askQuestion'

export type QuestionStatus = 'pending' | 'answered' | 'cancelled' | 'expired'

/** One question inside a record. `questionId` is the key answers are filed under. */
export interface GatewayQuestion {
  questionId: string
  question: string
  header?: string
  options?: AskOption[]
  multiSelect?: boolean
  isOther?: boolean
  isSecret?: boolean
}

export interface QuestionRecord {
  id: string
  questions: GatewayQuestion[]
  agentId?: string
  sessionKey?: string
  runId?: string
  createdAtMs: number
  expiresAtMs: number
  status: QuestionStatus
  resolvedBy?: string
}

/** Answers collected so far, keyed by `questionId`. */
export type CollectedAnswers = Record<string, string[]>

export function isPending(record: QuestionRecord, now = Date.now()): boolean {
  return record.status === 'pending' && record.expiresAtMs > now
}

/**
 * A record this app can actually present.
 *
 * `isSecret` questions are deliberately excluded: they ask for a credential, the card
 * renders options as buttons and has no masked input, and putting a secret through a
 * plain text field is not something to do by accident. Those stay for the gateway's own
 * Control UI until there's a real secret input here.
 */
export function isRenderable(record: QuestionRecord): boolean {
  return record.questions.length > 0
    && record.questions.every(q => q.isSecret !== true && (q.options?.length ?? 0) > 0)
}

/**
 * The pending, renderable question for one chat session, oldest first.
 *
 * A record without a `sessionKey` is gateway-wide (a channel turn, an automation) and is
 * deliberately not shown in a session thread — it belongs to no conversation here.
 */
export function pendingForSession(
  records: Iterable<QuestionRecord>,
  sessionKey: string | undefined,
  now = Date.now(),
): QuestionRecord | undefined {
  if (!sessionKey) return undefined
  return [...records]
    .filter(r => r.sessionKey === sessionKey && isPending(r, now) && isRenderable(r))
    .sort((a, b) => a.createdAtMs - b.createdAtMs)[0]
}

/** Render a gateway record through the same card the `<ask>` path uses. */
export function toAskQuestions(record: QuestionRecord): AskQuestion[] {
  return record.questions.map(q => ({
    id: q.questionId,
    question: q.question,
    ...(q.header ? { header: q.header } : {}),
    multiSelect: q.multiSelect === true,
    options: q.options ?? [],
  }))
}

/** Every question in the record has an answer, so the record can be resolved. */
export function isComplete(record: QuestionRecord, collected: CollectedAnswers): boolean {
  return record.questions.every(q => (collected[q.questionId]?.length ?? 0) > 0)
}

/**
 * Params for `question.resolve`.
 *
 * The double nesting is the gateway's: the method takes `answers`, whose value is itself
 * `{ answers: Record<questionId, string[]> }`. Answers for questions not in this record
 * are dropped rather than sent — the schema is closed and the manager owns the invariant
 * that answers match the record's questions.
 */
export function resolveParams(record: QuestionRecord, collected: CollectedAnswers): {
  id: string
  answers: { answers: CollectedAnswers }
} {
  const answers: CollectedAnswers = {}
  for (const q of record.questions) {
    const picked = collected[q.questionId]
    if (picked?.length) answers[q.questionId] = picked
  }
  return { id: record.id, answers: { answers } }
}

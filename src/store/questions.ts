import { create } from 'zustand'
import { gatewayClient } from '../lib/gateway'
import {
  isPending, resolveParams,
  type CollectedAnswers, type QuestionRecord,
} from '../lib/questions'

// Questions the gateway is holding open, with a run parked on the answer.
//
// Two sources, because either alone is not enough: `question.list` on connect catches
// anything asked while this client was away, and the `question.requested` /
// `question.resolved` broadcasts keep it live afterwards. A question answered from
// another client (the Control UI, a phone) arrives as `question.resolved` and drops out
// of here, so the card can't be answered twice.

interface QuestionsState {
  /** Pending records by id. Resolved/expired ones are removed rather than kept. */
  records: Record<string, QuestionRecord>
  /** Selections made in the card but not yet sent — a record resolves in one call. */
  drafts: Record<string, CollectedAnswers>
  /**
   * Sessions the gateway has been seen managing questions for.
   *
   * Sticky on purpose. An `ask_user` tool call also reserves a question record, so the
   * same prompt exists both as a tool call in the transcript and as a record here. Once
   * the record resolves it leaves `records`, and without this the transcript copy would
   * pop back as a live, clickable card — clicking it would send a chat turn answering a
   * question that is already closed.
   */
  managedSessions: Record<string, true>
  error: string | null
  _subscribed: boolean

  fetch: () => Promise<void>
  /** Idempotent: subscribes to the question.* broadcasts and loads the backlog. */
  start: () => void
  ingest: (event: string, payload: unknown) => void
  setAnswer: (recordId: string, questionId: string, labels: string[]) => void
  resolve: (record: QuestionRecord) => Promise<void>
  reset: () => void
}

export const useQuestionsStore = create<QuestionsState>((set, get) => ({
  records: {},
  drafts: {},
  managedSessions: {},
  error: null,
  _subscribed: false,

  start() {
    if (!get()._subscribed) {
      set({ _subscribed: true })
      gatewayClient.on(frame => {
        if (frame.event === 'question.requested' || frame.event === 'question.resolved') {
          get().ingest(frame.event, frame.payload)
        }
      })
    }
    void get().fetch()
  },

  async fetch() {
    try {
      const res = await gatewayClient.request<{ questions?: QuestionRecord[] }>('question.list', {})
      const records: Record<string, QuestionRecord> = {}
      const managed: Record<string, true> = { ...get().managedSessions }
      for (const r of res.questions ?? []) {
        if (r.sessionKey) managed[r.sessionKey] = true
        if (isPending(r)) records[r.id] = r
      }
      set({ records, managedSessions: managed, error: null })
    } catch (e) {
      // A gateway that withheld operator.questions rejects this. Not fatal: the
      // in-transcript <ask> path still works, so degrade quietly rather than banner.
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  ingest(event, payload) {
    const record = payload as QuestionRecord | undefined
    if (!record?.id) return
    if (event === 'question.requested') {
      set(s => ({
        ...(isPending(record) ? { records: { ...s.records, [record.id]: record } } : {}),
        ...(record.sessionKey ? { managedSessions: { ...s.managedSessions, [record.sessionKey]: true } } : {}),
      }))
      return
    }
    if (event === 'question.resolved') {
      set(s => {
        const records = { ...s.records }; delete records[record.id]
        const drafts = { ...s.drafts }; delete drafts[record.id]
        return { records, drafts }
      })
    }
  },

  setAnswer(recordId, questionId, labels) {
    set(s => ({
      drafts: { ...s.drafts, [recordId]: { ...s.drafts[recordId], [questionId]: labels } },
    }))
  },

  async resolve(record) {
    const collected = get().drafts[record.id] ?? {}
    // Drop it locally first so the card can't be double-submitted while the RPC is in
    // flight; question.resolved will confirm, and a failure restores it below.
    set(s => {
      const records = { ...s.records }; delete records[record.id]
      return { records }
    })
    try {
      await gatewayClient.request('question.resolve', resolveParams(record, collected))
      set(s => { const drafts = { ...s.drafts }; delete drafts[record.id]; return { drafts } })
    } catch (e) {
      set(s => ({
        records: { ...s.records, [record.id]: record },
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  },

  // `managedSessions` is intentionally kept: it describes the gateway's behaviour,
  // not this connection's state.
  reset() { set({ records: {}, drafts: {}, error: null }) },
}))

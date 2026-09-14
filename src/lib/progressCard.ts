import { takeFirstProgress, progressPct, progressCount } from './htmlBlocks'

// A session's progress card: the gateway's durable "where is this work at" surface.
//
// Models maintain it with the `progress_card` tool, which OpenClaw has shipped on by
// default since 2026.8. A card holds an ordered plan checklist, a short Markdown note, or
// both, and every write replaces the whole card. It lives next to the session, not in the
// transcript (the transcript keeps only a one-line receipt), so a client that doesn't
// read it shows nothing at all. `progressCard.get` returns the current card;
// `progressCard.changed` carries only `{sessionKey, revision}`, so a change means
// fetching again.

export type ProgressStepStatus = 'pending' | 'in_progress' | 'completed'
export interface ProgressStep { step: string; status: ProgressStepStatus }
export interface ProgressCard {
  /** The gateway's scope key: the session key in `agent:<id>:<key>` form. */
  sessionKey: string
  revision: number
  updatedAt?: number
  markdown?: string
  steps?: ProgressStep[]
}

const STATUSES = new Set<string>(['pending', 'in_progress', 'completed'])

function isStep(s: unknown): s is ProgressStep {
  if (!s || typeof s !== 'object') return false
  const r = s as Record<string, unknown>
  return typeof r.step === 'string' && r.step.trim() !== '' && typeof r.status === 'string' && STATUSES.has(r.status)
}

/** A card from the wire, or null when there isn't one: none written, cleared, or unreadable. */
export function parseProgressCard(raw: unknown): ProgressCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.revision !== 'number' || !Number.isFinite(r.revision)) return null
  const markdown = typeof r.markdown === 'string' && r.markdown.trim() ? r.markdown : undefined
  // A malformed step is dropped, not the card: the rest of the plan is still worth showing.
  const steps = Array.isArray(r.steps) ? r.steps.filter(isStep).map(s => ({ step: s.step, status: s.status })) : []
  if (!markdown && steps.length === 0) return null
  return {
    sessionKey: typeof r.sessionKey === 'string' ? r.sessionKey : '',
    revision: r.revision,
    ...(typeof r.updatedAt === 'number' ? { updatedAt: r.updatedAt } : {}),
    ...(markdown ? { markdown } : {}),
    ...(steps.length ? { steps } : {}),
  }
}

/**
 * Whether the key in a `progressCard.changed` event names this session. The gateway
 * reports its scope key, `agent:<id>:<key>`. For an agent-scoped session key (every chat
 * JoaxClaw starts) that is the key itself; for a bare key it's the key with an agent
 * prefix added.
 */
export function isSameSession(eventKey: string, sessionKey: string): boolean {
  const a = eventKey.trim().toLowerCase()
  const b = sessionKey.trim().toLowerCase()
  if (!a || !b) return false
  if (a === b) return true
  const m = /^agent:[^:]+:(.+)$/.exec(a)
  return !!m && !b.startsWith('agent:') && m[1] === b
}

export interface ProgressSummary {
  /** One line for the collapsed strip: the step in progress, else the bar's label, and so on. */
  headline: string
  /** The bar to draw: 0–100, or null for indeterminate. Absent when the card has nothing to measure. */
  track?: { pct: number | null }
  /** "2/3", "40%", or null when there is no count to show. */
  count: string | null
  done: boolean
  steps: ProgressStep[]
  /** The note with its pinned bar taken out, since the strip already draws that bar. */
  note: string
}

export function summarizeProgressCard(card: ProgressCard): ProgressSummary {
  const steps = card.steps ?? []
  const { progress, rest } = takeFirstProgress(card.markdown ?? '')
  const completed = steps.filter(s => s.status === 'completed').length
  const current = steps.find(s => s.status === 'in_progress')
  const next = steps.find(s => s.status === 'pending')
  const stepsDone = steps.length > 0 && completed === steps.length

  // The note's own bar wins: it's the measure the model chose for this work. Without
  // one, a plan is measured by its completed steps.
  const track = progress
    ? { pct: progressPct(progress) }
    : steps.length ? { pct: (completed / steps.length) * 100 } : undefined
  const count = progress ? progressCount(progress) : steps.length ? `${completed}/${steps.length}` : null
  const done = progress ? progress.value !== null && progress.value >= progress.max : stepsDone

  const headline = current?.step
    ?? progress?.label
    ?? (stepsDone ? 'All steps done' : undefined)
    ?? (next ? `Next: ${next.step}` : undefined)
    ?? firstLine(rest)
    ?? 'Progress'
  return { headline, ...(track ? { track } : {}), count, done, steps, note: rest }
}

/** The first line of a note as plain text, for the collapsed strip. */
function firstLine(md: string): string | undefined {
  return md.split('\n')
    .map(l => l.replace(/^[\s>#*+|-]+/, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim())
    .find(Boolean)
}

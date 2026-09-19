import { gatewayClient } from './gateway'
import { countTruncated, isUnavailableSentinel } from './chatExport'

// Reading a chat's WHOLE history from the gateway, for export (PRD 05). Opening a chat
// reads only its latest 500 entries; an export pages back to the start.
//
// chat.history pages count back from the newest record: no offset is the latest page,
// and each response says `hasMore` and where the next (older) page starts, `nextOffset`.
// The first request carries no `offset` at all: 2026.6.5's closed schema rejects the
// field, and without it an older gateway simply answers with one page and no paging
// fields. Offsets and `totalMessages` count raw transcript records, hidden ones
// included, so progress is measured in offsets, never in rows.
//
// When a page's byte cap cut its oldest record part-way, the gateway repeats that whole
// record at the start of the next (older) page. One record can also project to two rows
// sharing an id, so de-duplication is per page boundary, by record, not a Set of ids.
//
// A chat that is still running grows while it's read: every record the run appends
// raises `totalMessages`, and since offsets count back from the newest record, the same
// offset now lands that many records newer. Growth at the tail is not a change: the read
// keeps to the records that existed when its first page came back (the snapshot) and
// shifts each later offset by the growth, so the pages still meet. Record `seq`s count
// from the oldest record and don't move when the tail grows, so where pages overlap, a
// record with a different id under the same seq means history was rewritten (a branch
// switched, say): that, a new sessionId or a shrinking total restarts the read.

export const EXPORT_PAGE_LIMIT = 1000
/** Text blocks are cut at 8000 characters by default; export asks for the gateway's maximum. */
export const EXPORT_MAX_CHARS = 500_000
/** A remote page can be several MB; the default 30 s request timeout is too tight for it. */
const PAGE_TIMEOUT_MS = 90_000
/** Transient "rebuilding" answers are retried this many times per page. */
const TRANSIENT_RETRIES = 4

export interface HistoryPage {
  sessionId?: string
  messages?: unknown[]
  hasMore?: boolean
  nextOffset?: number
  offset?: number
  totalMessages?: number
  sessionInfo?: { hasActiveRun?: boolean } & Record<string, unknown>
}

export class ChatChangedError extends Error {
  constructor() { super('This chat changed while it was being read. Try again.') }
}

/** The params for the next page, or null when there are no more. Throws on a page that makes no progress. */
export function nextPageParams(sessionKey: string, prev?: HistoryPage, prevOffset = 0, limit = EXPORT_PAGE_LIMIT): Record<string, unknown> | null {
  const base = { sessionKey, limit, maxChars: EXPORT_MAX_CHARS }
  if (!prev) return base
  if (prev.hasMore !== true) return null
  // Following a missing or backwards offset would loop forever.
  if (typeof prev.nextOffset !== 'number' || prev.nextOffset <= prevOffset) {
    throw new Error("The gateway's history pages didn't line up.")
  }
  return { ...base, offset: prev.nextOffset }
}

function seqOf(m: unknown): number | undefined {
  const meta = m && typeof m === 'object' ? (m as { __openclaw?: { seq?: unknown } }).__openclaw : undefined
  return typeof meta?.seq === 'number' ? meta.seq : undefined
}

function idOf(m: unknown): string | undefined {
  const meta = m && typeof m === 'object' ? (m as { __openclaw?: { id?: unknown } }).__openclaw : undefined
  return typeof meta?.id === 'string' ? meta.id : undefined
}

/**
 * Pages as read (newest first) into one list, oldest first. Where an older page repeats
 * the record a newer page started with, the older page's copy is the whole record, so
 * the newer page's rows for it are dropped. Rows of records newer than that (an older
 * page read while the chat grew overlaps further) are already in, and are skipped.
 */
export function assemblePages(pages: unknown[][]): unknown[] {
  let out: unknown[] = []
  for (const page of pages) {
    const oldest = out.map(seqOf).find(s => s !== undefined)
    let older = page
    if (oldest !== undefined) {
      older = page.filter(m => { const s = seqOf(m); return s === undefined || s <= oldest })
      if (older.some(m => seqOf(m) === oldest)) out = out.filter(m => seqOf(m) !== oldest)
    }
    out = [...older, ...out]
  }
  return out
}

/** Each record's id by seq, from pages already read. */
export function recordIds(pages: unknown[][]): Map<number, string> {
  const ids = new Map<number, string>()
  for (const page of pages) for (const m of page) {
    const s = seqOf(m), id = idOf(m)
    if (s !== undefined && id !== undefined) ids.set(s, id)
  }
  return ids
}

/** Whether a page puts a different record under a seq already read: history was rewritten. */
export function pageConflicts(known: Map<number, string>, page: unknown[]): boolean {
  return page.some(m => {
    const s = seqOf(m), id = idOf(m)
    return s !== undefined && id !== undefined && known.has(s) && known.get(s) !== id
  })
}

/**
 * How many records a later page's transcript has gained since the first page, or null
 * when it isn't the same transcript any more (another sessionId, or fewer records).
 */
export function pageGrowth(first: HistoryPage, page: HistoryPage): number | null {
  if (first.sessionId !== page.sessionId) return null
  if (first.totalMessages === page.totalMessages) return 0
  if (typeof first.totalMessages !== 'number' || typeof page.totalMessages !== 'number') return null
  const grown = page.totalMessages - first.totalMessages
  return grown > 0 ? grown : null
}

/** How far through the records the read is, from the offsets (records, not rows). */
export function pagedProgress(page: HistoryPage): { read: number; total?: number } {
  const total = page.totalMessages
  if (typeof total !== 'number') return { read: 0 }
  return { read: page.hasMore === true && typeof page.nextOffset === 'number' ? page.nextOffset : total, total }
}

interface GatewayFrame { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number }
const frameOf = (err: unknown): GatewayFrame | undefined =>
  err && typeof err === 'object' && 'gatewayError' in err ? (err as { gatewayError: GatewayFrame }).gatewayError : undefined

/** The gateway's own message for a read error, not the JSON the client wraps it in. */
export function readErrorMessage(err: unknown): string {
  const f = frameOf(err)
  if (f?.message) return f.message
  return err instanceof Error ? err.message : String(err)
}

/**
 * How to treat a failed page. The gateway answers `UNAVAILABLE`, retryable, with a short
 * retryAfterMs while it rebuilds a session's history ("retry shortly"), and when the
 * transcript moved under the read ("session changed while reading history"); the first
 * is retried in place, the second restarts the read.
 */
export function classifyReadError(err: unknown): { kind: 'retry'; afterMs: number } | { kind: 'restart' } | { kind: 'fail' } {
  const f = frameOf(err)
  if (!f || f.code !== 'UNAVAILABLE' || f.retryable !== true) return { kind: 'fail' }
  if (/changed while reading/i.test(f.message ?? '')) return { kind: 'restart' }
  return { kind: 'retry', afterMs: Math.min(Math.max(f.retryAfterMs ?? 250, 100), 5_000) }
}

export interface FullHistory {
  /** The gateway's messages, oldest first, unmodified. */
  raw: unknown[]
  /** totalMessages from the gateway (records), else the rows read. */
  total: number
  /** Messages the gateway shortened or left out. */
  truncatedCount: number
  /** A run was still going when the read started. */
  activeRun: boolean
  /** The gateway sent its "transcript too large to display" sentinel instead of history. */
  unavailable: boolean
  /** The gateway pages (2026.7+). Without it only the latest page could be read. */
  pagingSupported: boolean
  sessionInfo?: Record<string, unknown>
}

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>

const aborted = () => new DOMException('Aborted', 'AbortError')
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(aborted()) }, { once: true })
})

/**
 * Read every page. `onProgress(read, total?)` after each page, in records of the
 * snapshot. Aborting rejects with an AbortError and sends nothing more. Records a
 * running chat appends while it's read are left out: the file is the chat as of the
 * first page, marked as still running. If the history changes between pages the read
 * starts over once; if it changes again it fails with ChatChangedError, rather than
 * saving a chat stitched together from two states.
 */
export async function readFullHistory(
  sessionKey: string,
  opts: { onProgress?: (read: number, total?: number) => void; signal?: AbortSignal; request?: Request; limit?: number } = {},
): Promise<FullHistory> {
  const request: Request = opts.request ?? ((m, p) => gatewayClient.request(m, p, PAGE_TIMEOUT_MS))
  const fetchPage = async (params: Record<string, unknown>): Promise<HistoryPage> => {
    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw aborted()
      try {
        const page = (await request('chat.history', params) ?? {}) as HistoryPage
        if (opts.signal?.aborted) throw aborted()
        return page
      } catch (err) {
        const how = classifyReadError(err)
        if (how.kind === 'restart') throw new ChatChangedError()
        if (how.kind === 'fail' || attempt >= TRANSIENT_RETRIES) throw err
        await sleep(how.afterMs, opts.signal)
      }
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const pages: unknown[][] = []
    let first: HistoryPage | undefined
    let changed = false
    // Records appended since the first page. Offsets sent are the snapshot's plus this.
    let grown = 0
    try {
      let params = nextPageParams(sessionKey, undefined, 0, opts.limit)
      let snapOffset = 0
      while (params) {
        const page = await fetchPage(params)
        const messages = Array.isArray(page.messages) ? page.messages : []
        if (first) {
          const g = pageGrowth(first, page)
          if (g === null || g < grown || pageConflicts(recordIds(pages), messages)) { changed = true; break }
          grown = g
        }
        first ??= page
        pages.push(messages)
        const sent = typeof params.offset === 'number' ? params.offset : 0
        const next = nextPageParams(sessionKey, page, sent, opts.limit)
        // The gateway's nextOffset counts from this page's (grown) total; take the growth
        // back out for the snapshot's, which has to move on from the last one.
        const nextSnap = next ? (next.offset as number) - grown : undefined
        if (nextSnap !== undefined && nextSnap <= snapOffset) throw new Error("The gateway's history pages didn't line up.")
        const total = first.totalMessages
        opts.onProgress?.(typeof total === 'number' ? nextSnap ?? total : pages.reduce((n, p) => n + p.length, 0), total)
        if (!next || nextSnap === undefined) break
        snapOffset = nextSnap
        // Once the chat has grown, ask for one record more on the newer side, so the
        // page overlaps what's read and a rewritten record can't slip in unseen.
        params = { ...next, offset: nextSnap + grown - (grown > 0 ? 1 : 0) }
      }
    } catch (err) {
      if (!(err instanceof ChatChangedError)) throw err
      changed = true
    }
    if (changed) continue
    const raw = assemblePages(pages)
    return {
      raw,
      total: first?.totalMessages ?? raw.length,
      truncatedCount: countTruncated(raw),
      // A chat that grew while it was read was running, even if it wasn't at the start.
      activeRun: first?.sessionInfo?.hasActiveRun === true || grown > 0,
      unavailable: raw.some(isUnavailableSentinel),
      pagingSupported: first?.hasMore !== undefined,
      sessionInfo: first?.sessionInfo,
    }
  }
  throw new ChatChangedError()
}

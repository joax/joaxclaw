import { describe, it, expect } from 'vitest'
import {
  nextPageParams, assemblePages, readFullHistory, pagedProgress, classifyReadError, readErrorMessage,
  ChatChangedError, EXPORT_MAX_CHARS, type HistoryPage,
} from '../chatHistoryReader'
import {
  SESSION_KEY, PAGING_PAGE_A, PAGING_PAGE_B, PAGING_PAGE_C, PAGING_REQUESTS, PAGING_EXPECTED_TEXTS,
  PAGING_PAGE_B_CHANGED, PAGING_PAGE_B_NEW_SESSION, HISTORY_RESPONSE_2026_6_5, EXPORT_HISTORY_RESPONSE,
  ERROR_HISTORY_REBUILDING, ERROR_SESSION_CHANGED, ERROR_MISSING_READ_SCOPE, EXPECTED_TRUNCATED_COUNT,
} from './fixtures/sprint/chatExport'

// Reading a whole chat for export: chat.history pages back from the newest record, the
// first request without `offset` (2026.6.5 rejects it), following nextOffset, and merging
// pages where the gateway replays a record across the boundary (2026.9.4 source shapes).

const asError = (e: object) => Object.assign(new Error(JSON.stringify(e)), { gatewayError: e })
const text = (m: unknown) => ((m as { content: { text: string }[] }).content[0].text)

/** A fake gateway that answers each call from a list, recording the params. */
function fakeGateway(answers: (HistoryPage | Error)[]) {
  const calls: Record<string, unknown>[] = []
  const request = async (_m: string, p: Record<string, unknown>) => {
    calls.push(p)
    const a = answers.shift()
    if (!a) throw new Error('no more answers')
    if (a instanceof Error) throw a
    return a
  }
  return { calls, request }
}

describe('nextPageParams', () => {
  it('asks for the first page without an offset', () => {
    expect(nextPageParams(SESSION_KEY)).toEqual({ sessionKey: SESSION_KEY, limit: 1000, maxChars: EXPORT_MAX_CHARS })
    expect(nextPageParams(SESSION_KEY)).not.toHaveProperty('offset')
  })

  it('follows nextOffset, and stops when there is no more', () => {
    expect(nextPageParams(SESSION_KEY, PAGING_PAGE_A, 0)).toMatchObject({ offset: 10 })
    expect(nextPageParams(SESSION_KEY, PAGING_PAGE_B, 10)).toMatchObject({ offset: 18 })
    expect(nextPageParams(SESSION_KEY, PAGING_PAGE_C, 18)).toBeNull()
  })

  it('stops after one page on a gateway without paging', () => {
    expect(nextPageParams(SESSION_KEY, HISTORY_RESPONSE_2026_6_5, 0)).toBeNull()
  })

  it('refuses to loop on a missing or backwards offset', () => {
    expect(() => nextPageParams(SESSION_KEY, { hasMore: true }, 0)).toThrow()
    expect(() => nextPageParams(SESSION_KEY, { hasMore: true, nextOffset: 10 }, 10)).toThrow()
  })
})

describe('assemblePages', () => {
  it('merges pages oldest first, keeping both rows of a replayed record exactly once', () => {
    const raw = assemblePages([PAGING_PAGE_A.messages!, PAGING_PAGE_B.messages!, PAGING_PAGE_C.messages!])
    expect(raw.map(text)).toEqual(PAGING_EXPECTED_TEXTS)
  })

  it('keeps rows that share an id within one record', () => {
    const raw = assemblePages([PAGING_PAGE_C.messages!])
    expect(raw.filter(m => (m as { __openclaw: { id: string } }).__openclaw.id === 'ev-07')).toHaveLength(2)
  })
})

describe('pagedProgress', () => {
  it('counts records by offset, not rows', () => {
    expect(pagedProgress(PAGING_PAGE_A)).toEqual({ read: 10, total: 25 })
    expect(pagedProgress(PAGING_PAGE_C)).toEqual({ read: 25, total: 25 })
    expect(pagedProgress(HISTORY_RESPONSE_2026_6_5)).toEqual({ read: 0 })
  })
})

describe('readFullHistory', () => {
  it('walks every page with the right params', async () => {
    const gw = fakeGateway([PAGING_PAGE_A, PAGING_PAGE_B, PAGING_PAGE_C])
    const progress: [number, number | undefined][] = []
    const res = await readFullHistory(SESSION_KEY, { request: gw.request, limit: 10, onProgress: (r, t) => progress.push([r, t]) })
    expect(gw.calls).toEqual(PAGING_REQUESTS)
    expect(res.raw.map(text)).toEqual(PAGING_EXPECTED_TEXTS)
    expect(res).toMatchObject({ total: 25, activeRun: false, pagingSupported: true, unavailable: false })
    expect(progress).toEqual([[10, 25], [18, 25], [25, 25]])
  })

  it('reports truncation and a running chat from one page', async () => {
    const res = await readFullHistory(SESSION_KEY, { request: fakeGateway([EXPORT_HISTORY_RESPONSE]).request })
    expect(res.truncatedCount).toBe(EXPECTED_TRUNCATED_COUNT)
    expect(res.activeRun).toBe(true)
  })

  it('reads the single page of a gateway without paging', async () => {
    const gw = fakeGateway([HISTORY_RESPONSE_2026_6_5])
    const res = await readFullHistory(SESSION_KEY, { request: gw.request })
    expect(gw.calls).toHaveLength(1)
    expect(gw.calls[0]).not.toHaveProperty('offset')
    expect(res.pagingSupported).toBe(false)
  })

  it('starts over once when the chat changes between pages, then succeeds', async () => {
    const gw = fakeGateway([PAGING_PAGE_A, PAGING_PAGE_B_CHANGED, PAGING_PAGE_A, PAGING_PAGE_B, PAGING_PAGE_C])
    const res = await readFullHistory(SESSION_KEY, { request: gw.request, limit: 10 })
    expect(res.raw.map(text)).toEqual(PAGING_EXPECTED_TEXTS)
  })

  it('fails if the chat changes again', async () => {
    const gw = fakeGateway([PAGING_PAGE_A, PAGING_PAGE_B_NEW_SESSION, PAGING_PAGE_A, PAGING_PAGE_B_CHANGED])
    await expect(readFullHistory(SESSION_KEY, { request: gw.request, limit: 10 })).rejects.toBeInstanceOf(ChatChangedError)
  })

  it('retries a page while the gateway rebuilds the history', async () => {
    const gw = fakeGateway([asError(ERROR_HISTORY_REBUILDING), EXPORT_HISTORY_RESPONSE])
    const res = await readFullHistory(SESSION_KEY, { request: gw.request })
    expect(gw.calls).toHaveLength(2)
    expect(res.raw).toHaveLength(EXPORT_HISTORY_RESPONSE.messages.length)
  })

  it('restarts the read when the session changed while reading', async () => {
    const gw = fakeGateway([asError(ERROR_SESSION_CHANGED), EXPORT_HISTORY_RESPONSE])
    await expect(readFullHistory(SESSION_KEY, { request: gw.request })).resolves.toMatchObject({ activeRun: true })
  })

  it('fails on a real error, with the gateway message', async () => {
    const gw = fakeGateway([asError(ERROR_MISSING_READ_SCOPE)])
    const err = await readFullHistory(SESSION_KEY, { request: gw.request }).catch(e => e)
    expect(readErrorMessage(err)).toBe('missing scope: operator.read')
  })

  it('stops when aborted, sending nothing more', async () => {
    const ctrl = new AbortController()
    const gw = fakeGateway([PAGING_PAGE_A, PAGING_PAGE_B, PAGING_PAGE_C])
    const res = readFullHistory(SESSION_KEY, { request: gw.request, limit: 10, signal: ctrl.signal, onProgress: () => ctrl.abort() })
    await expect(res).rejects.toMatchObject({ name: 'AbortError' })
    expect(gw.calls).toHaveLength(1)
  })
})

describe('classifyReadError', () => {
  it('retries rebuilding, restarts on a changed session, fails otherwise', () => {
    expect(classifyReadError(asError(ERROR_HISTORY_REBUILDING))).toEqual({ kind: 'retry', afterMs: 250 })
    expect(classifyReadError(asError(ERROR_SESSION_CHANGED))).toEqual({ kind: 'restart' })
    expect(classifyReadError(asError(ERROR_MISSING_READ_SCOPE))).toEqual({ kind: 'fail' })
    expect(classifyReadError(new Error('Disconnected'))).toEqual({ kind: 'fail' })
  })
})

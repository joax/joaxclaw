// Full-text search across session transcripts (`sessions.search`, OpenClaw 2026.9).
//
// The sessions list already filters by name and key, but that only ever sees what the
// client has loaded and only matches titles. This searches the message text the gateway
// holds, including sessions well past the loaded window.
//
// Two constraints shape the whole feature, both learned from a live gateway rather than
// the schema:
//
//  1. It is SCOPED, not global. `sessions.search` takes an explicit `sessionKeys` list
//     of at most 200. Omitting it makes the gateway fall back to the session key "main",
//     which on a multi-agent gateway fails outright with "session key \"main\" has no
//     explicit owner". Passing `agentId` instead does not help — it answers
//     "agentId requires sessionKeys".
//  2. One session key spans several `sessionId` generations, and hits come back from all
//     of them, so results group by key rather than by id.

/** The gateway's cap on `sessionKeys`; a longer array is a hard INVALID_REQUEST. */
export const MAX_SEARCH_SESSION_KEYS = 200
/** The gateway's cap on `limit`. */
export const MAX_SEARCH_RESULTS = 25

export interface SessionSearchHit {
  sessionKey: string
  sessionId: string
  messageId: string
  role: 'user' | 'assistant'
  timestamp: number
  snippet: string
  score: number
}

export interface SessionSearchParams {
  query: string
  sessionKeys: string[]
  limit: number
}

/**
 * Params for `sessions.search`, or null when there is nothing to ask.
 *
 * `keys` should arrive most-recent-first: past the cap the newest sessions are the ones
 * worth searching, and the caller is told what was left out so the UI can say so rather
 * than quietly under-reporting.
 */
export function buildSearchParams(
  query: string,
  keys: readonly string[],
  limit = MAX_SEARCH_RESULTS,
): { params: SessionSearchParams; searched: number; skipped: number } | null {
  const q = query.trim()
  if (!q) return null
  const unique = [...new Set(keys.filter(Boolean))]
  if (unique.length === 0) return null
  const sessionKeys = unique.slice(0, MAX_SEARCH_SESSION_KEYS)
  return {
    params: {
      query: q,
      sessionKeys,
      limit: Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_SEARCH_RESULTS),
    },
    searched: sessionKeys.length,
    skipped: unique.length - sessionKeys.length,
  }
}

export interface SessionSearchGroup {
  sessionKey: string
  hits: SessionSearchHit[]
}

/**
 * Group hits by session, keeping the gateway's ranking.
 *
 * Order follows each session's best-ranked hit, so the most relevant conversation leads
 * even when a lower-ranked one matched more often.
 */
export function groupHits(hits: readonly SessionSearchHit[]): SessionSearchGroup[] {
  const groups = new Map<string, SessionSearchHit[]>()
  for (const hit of hits) {
    const existing = groups.get(hit.sessionKey)
    if (existing) existing.push(hit)
    else groups.set(hit.sessionKey, [hit])
  }
  return [...groups.entries()].map(([sessionKey, hits]) => ({ sessionKey, hits }))
}

/** Collapse whitespace and cap a snippet so a match doesn't blow out the row. */
export function trimSnippet(text: string, max = 220): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean
}

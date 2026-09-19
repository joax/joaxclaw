// Meetings: the gateway's transcript library, and the plugins that put an agent in a call.
//
// What the gateway keeps is NOTES, not recordings. The Google Meet, Teams and Zoom
// plugins join a call as a browser participant and read the platform's captions; the
// gateway stores the finished caption rows and a summary derived from them. No audio or
// video file is ever made (docs/plugins/meeting-plugins.md), and notes only exist when
// the platform shows captions. Every string here says "notes" and "transcript" for that
// reason.
//
// Library shapes are from packages/gateway-protocol/src/schema/transcripts.ts (2026.9.4):
// `transcripts.list` / `get` since 2026.8, `status` / `export` since 2026.9. There are no
// transcript events, so the store polls.

export type PlatformId = 'meet' | 'teams' | 'zoom'

export interface Platform {
  id: PlatformId
  label: string
  /** The plugin's runtime id: its plugins.list row once installed, and its config entry. */
  pluginId: string
  /**
   * The id plugins.install { source: "official" } takes. Google Meet's catalog entry is
   * keyed by its package name ("@openclaw/google-meet"); asking for "google-meet" is
   * refused as "unknown official plugin catalog entry" (seen on 2026.9.4).
   */
  installId: string
  /** The agent tool the plugin registers. */
  tool: string
  /** The transcript provider id its notes are filed under. */
  providerId: string
  /** The npm package, for the host install command. */
  npm: string
  /** The platform's own setup check, run on the gateway host. */
  setupCommand: string
  /** Name for the install flow and overlay ("Restarting to finish installing Zoom meetings"). */
  pluginName: string
}

export const PLATFORMS: Record<PlatformId, Platform> = {
  meet: {
    id: 'meet', label: 'Google Meet', pluginId: 'google-meet', installId: '@openclaw/google-meet', tool: 'google_meet', providerId: 'google-meet',
    npm: '@openclaw/google-meet', setupCommand: 'openclaw googlemeet setup --json', pluginName: 'Google Meet',
  },
  teams: {
    id: 'teams', label: 'Teams', pluginId: 'teams-meetings', installId: 'teams-meetings', tool: 'teams_meetings', providerId: 'teams',
    npm: '@openclaw/teams-meetings', setupCommand: 'openclaw teamsmeetings setup', pluginName: 'Teams meetings',
  },
  zoom: {
    id: 'zoom', label: 'Zoom', pluginId: 'zoom-meetings', installId: 'zoom-meetings', tool: 'zoom_meetings', providerId: 'zoom',
    npm: '@openclaw/zoom-meetings', setupCommand: 'openclaw zoommeetings setup', pluginName: 'Zoom meetings',
  },
}
export const PLATFORM_LIST: Platform[] = [PLATFORMS.meet, PLATFORMS.teams, PLATFORMS.zoom]

// ── Library shapes ─────────────────────────────────────────────────────────────

export interface TranscriptSource {
  providerId: string
  kind?: 'live-audio' | 'live-caption' | 'posthoc-transcript' | 'recording-stt'
  accountId?: string
  guildId?: string
  channelId?: string
  meetingUrl?: string
}

/** One library entry (`TranscriptSessionSummarySchema`). */
export interface TranscriptSession {
  selector: string
  sessionId: string
  title?: string
  providerId: string
  providerName?: string
  source: TranscriptSource
  startedAt: string
  stoppedAt?: string
  active: boolean
  utteranceCount: number
  participants: string[]
  hasSummary: boolean
  summarySource?: 'model' | 'heuristic'
  overview?: string
  agentId: string | null
  updatedAt: string
  lastUtteranceAt: string | null
  activeSubscription: boolean
}

export interface StoredSummary {
  generatedAt: string
  overview: string
  decisions: string[]
  actionItems: string[]
  risks: string[]
  participants: string[]
  source?: 'model' | 'heuristic'
  model?: string
  markdown: string
  utteranceCount: number
}

export interface Utterance {
  sequence: number
  text: string
  id?: string
  startedAt?: string
  endedAt?: string
  speakerId?: string
  speakerLabel?: string
  final?: boolean
}

export type SourceState = 'disabled' | 'armed' | 'not-active' | 'unknown'

export interface TranscriptStatus {
  enabled: boolean
  providers: {
    providerId: string
    pluginId?: string
    name: string
    availability: 'enabled' | 'disabled' | 'unavailable' | 'unknown'
    canStart?: boolean
    canStop?: boolean
  }[]
  configuredSources: {
    source: TranscriptSource
    title?: string
    sessionId?: string
    state: SourceState
    activeSelectors: string[]
    startDiagnostic?: 'starting' | 'retrying' | 'id-conflict' | 'admitted-start-failed' | 'start-failed' | 'ended'
  }[]
  active: TranscriptSession[]
  latestTranscript: TranscriptSession | null
}

// ── Providers ──────────────────────────────────────────────────────────────────

// The gateway accepts aliases for each provider; the library files notes under the
// canonical id. Mapping both ways keeps filters and labels consistent.
const PROVIDER_ALIASES: Record<string, string> = {
  'google-meet': 'google-meet', googlemeet: 'google-meet', meet: 'google-meet',
  teams: 'teams', 'teams-meetings': 'teams', msteams: 'teams', 'microsoft-teams': 'teams',
  zoom: 'zoom', 'zoom-meetings': 'zoom',
  'discord-voice': 'discord-voice',
}
const PROVIDER_LABELS: Record<string, string> = {
  'google-meet': 'Google Meet', teams: 'Teams', zoom: 'Zoom', 'discord-voice': 'Discord',
}

/** The canonical provider id for a provider id or alias. Unknown ids pass through. */
export function canonicalProvider(id: string): string {
  return PROVIDER_ALIASES[id.toLowerCase()] ?? id
}

/** "Google Meet", "Teams", "Zoom", "Discord", or the gateway's own name for anything else. */
export function providerLabel(id: string, fallbackName?: string): string {
  return PROVIDER_LABELS[canonicalProvider(id)] ?? fallbackName ?? id
}

/** The provider as a row shows it: the gateway's own name for it, else ours. */
export function sessionProvider(s: Pick<TranscriptSession, 'providerId' | 'providerName'>): string {
  return s.providerName?.trim() || providerLabel(s.providerId)
}

/**
 * Provider filter tabs, in a fixed order, for the providers present in the library. The
 * library's filter is an exact match on the canonical id, so that's what a tab sends.
 */
export function providerFilters(ids: Iterable<string>): { id: string; label: string }[] {
  const seen = new Set([...ids].map(canonicalProvider))
  const order = ['google-meet', 'teams', 'zoom', 'discord-voice']
  const known = order.filter(id => seen.has(id))
  const other = [...seen].filter(id => !order.includes(id) && id !== 'manual-transcript').sort()
  return [...known, ...other].map(id => ({ id, label: providerLabel(id) }))
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** The row title: the meeting's own, or "{Provider} meeting". */
export function meetingTitle(s: Pick<TranscriptSession, 'title' | 'providerId' | 'providerName'>): string {
  return s.title?.trim() || `${sessionProvider(s)} meeting`
}

/**
 * How long a meeting lasted, or has lasted so far. There's no duration field; it's
 * `stoppedAt − startedAt`, or `now − startedAt` while it's live.
 */
export function durationLabel(startedAt: string, stoppedAt: string | undefined, now = Date.now()): string {
  const start = Date.parse(startedAt)
  const end = stoppedAt ? Date.parse(stoppedAt) : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return ''
  const mins = Math.floor(Math.max(0, end - start) / 60_000)
  if (mins < 1) return 'under 1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "Mon 14 Sep", with the time when `withTime`. Local time zone. */
export function meetingDate(iso: string, withTime = false): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return withTime ? `${date} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : date
}

/** "{provider} · {date} · {duration} · {n} people", dropping what isn't known. */
export function meetingMeta(s: TranscriptSession, opts: { withTime?: boolean; now?: number } = {}): string {
  const people = s.participants.length
  // `participants` are speaker labels from the captions, so none just means nobody spoke.
  return [
    sessionProvider(s),
    meetingDate(s.startedAt, opts.withTime),
    durationLabel(s.startedAt, s.stoppedAt, opts.now),
    people ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
  ].filter(Boolean).join(' · ')
}

/** The row's pill: Recording while live, No speech for an empty finished one. */
export function meetingPill(s: Pick<TranscriptSession, 'active' | 'utteranceCount'>): { tone: 'working' | 'neutral'; text: string } | null {
  if (s.active) return { tone: 'working', text: 'Recording' }
  if (s.utteranceCount === 0) return { tone: 'neutral', text: 'No speech' }
  return null
}

/** The Dashboard's Recent meetings: every live one, then the three latest finished ones. */
export function recentMeetings(sessions: TranscriptSession[], active: TranscriptSession[], limit = 3): TranscriptSession[] {
  const live = new Map<string, TranscriptSession>()
  for (const s of [...active, ...sessions]) if (s.active && !live.has(s.selector)) live.set(s.selector, s)
  const done = sessions.filter(s => !live.has(s.selector)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return [...live.values(), ...done.slice(0, limit)]
}

// ── Errors ────────────────────────────────────────────────────────────────────

export type TranscriptErrorKind = 'invalidCursor' | 'notFound' | 'tooLarge' | 'exportTooLarge' | 'forbidden' | 'missingScope' | 'unavailable' | 'other'

/**
 * What a failed transcripts.* call means. Library errors are INVALID_REQUEST with a
 * `details.type`; sessions hidden by the operator role are FORBIDDEN with no details;
 * a missing scope is also FORBIDDEN, but says so in `details.code`; anything else is
 * UNAVAILABLE.
 */
export function readTranscriptError(error: unknown): TranscriptErrorKind {
  const e = error as { code?: unknown; details?: { type?: unknown; code?: unknown } } | null
  const type = e?.details?.type
  if (type === 'transcript_invalid_cursor') return 'invalidCursor'
  if (type === 'transcript_session_not_found') return 'notFound'
  if (type === 'transcript_export_too_large') return 'exportTooLarge'
  if (type === 'transcript_result_too_large') return 'tooLarge'
  if (e?.code === 'FORBIDDEN') return e.details?.code === 'MISSING_SCOPE' ? 'missingScope' : 'forbidden'
  if (e?.code === 'UNAVAILABLE') return 'unavailable'
  return 'other'
}

// ── Download ──────────────────────────────────────────────────────────────────

/** The export's base64 payload as bytes, decoded in one pass. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * The host command for a transcript too big to download (over 4 MiB). There's no
 * `transcripts export` subcommand; `path --transcript` prints where the file is.
 */
export function tooLargeCommand(selector: string): string {
  return `openclaw transcripts path ${shellQuote(selector)} --transcript`
}

function shellQuote(s: string): string {
  return /^[\w./:-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Whether a stored summary has its structured parts. Notes written before the summary
 * metadata existed come back with the defaults filled in (empty overview and lists) and
 * only `markdown`; the reader shows that instead of a page of empty sections.
 */
export function summaryHasStructure(s: StoredSummary): boolean {
  return !!s.overview.trim() || s.decisions.length > 0 || s.actionItems.length > 0 || s.risks.length > 0
}

// ── Agent prompts ─────────────────────────────────────────────────────────────

/** Asks an agent to write the summary the library is missing. */
export function buildSummarizePrompt(selector: string): string {
  return `Use the transcripts tool with action "summarize" and selector "${selector}". Reply "done" when finished.`
}

/** The first message of "Discuss in a new chat": what the meeting was, and its notes. */
export function buildDiscussMessage(s: TranscriptSession, markdown: string | undefined): string {
  const head = `Here are the notes from "${meetingTitle(s)}" (${meetingDate(s.startedAt)}, ${sessionProvider(s)}). `
    + `Its transcript selector is ${s.selector}; use the transcripts tool to read the full transcript if you need it.`
  return markdown?.trim() ? `${head}\n\n${markdown.trim()}` : head
}

// ── Recording: links ──────────────────────────────────────────────────────────

function parseLink(raw: string): URL | null {
  const t = raw.trim()
  if (!t || /\s/.test(t)) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
}

/**
 * Which platform a pasted link is for, or null. Hosts are matched exactly (or as a
 * `*.zoom.us` subdomain), so look-alikes such as `evilzoom.us` or `zoom.us.evil.com`
 * don't pass, and only the join paths the plugins accept count: a Zoom personal link
 * (`zoom.us/my/…`) can't be joined.
 */
export function detectPlatform(raw: string): PlatformId | null {
  const u = parseLink(raw)
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null
  const host = u.hostname.toLowerCase()
  const path = u.pathname
  if (host === 'meet.google.com' && /^\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}\/?$/i.test(path)) return 'meet'
  if (host === 'teams.microsoft.com' && path.startsWith('/l/meetup-join/')) return 'teams'
  if (host === 'teams.live.com' && path.startsWith('/meet/')) return 'teams'
  if ((host === 'zoom.us' || host.endsWith('.zoom.us')) && /^\/j\/\d+/.test(path)) return 'zoom'
  return null
}

/**
 * A link as the gateway files it: origin + path, with the query (Zoom's `pwd` included)
 * and fragment dropped, and the host lower-cased. `source.meetingUrl` on a live session
 * is exactly that, so this is what to compare. The join itself is sent the full link.
 */
export function normaliseMeetingUrl(raw: string): string | null {
  const u = parseLink(raw)
  return u ? `${u.protocol}//${u.host.toLowerCase()}${u.pathname}` : null
}

/** Two links for the same meeting, ignoring scheme case, host case and a trailing slash. */
function sameMeeting(a: string, b: string): boolean {
  const key = (s: string) => (normaliseMeetingUrl(s) ?? s).replace(/\/+$/, '').replace(/^http:/, 'https:')
  return key(a) === key(b)
}

/** The live session a join produced, matched on the link; the newest when several match. */
export function matchActiveSession(url: string, active: TranscriptSession[]): TranscriptSession | null {
  const hits = active.filter(s => s.active && s.source.meetingUrl && sameMeeting(s.source.meetingUrl, url))
  hits.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return hits[0] ?? null
}

// ── Recording: prompts ───────────────────────────────────────────────────────

export type JoinMode = 'transcribe' | 'agent'

/** The sentinel the join prompt asks for when the agent has no meeting tool. */
export const TOOL_MISSING = 'MEETING_TOOL_MISSING'

/**
 * The instruction that sends an agent into a call. The mode is always explicit: the
 * plugins default to `agent` (speaking), and "Take notes only" must not depend on that.
 */
export function buildJoinPrompt(platform: PlatformId, url: string, mode: JoinMode): string {
  return `Use the \`${PLATFORMS[platform].tool}\` tool with action "join", url "${url.trim()}", mode "${mode}". Do only this. `
    + `Then reply with the tool's result exactly, including any status or manualAction, and nothing else. `
    + `If the tool isn't available, say "${TOOL_MISSING}".`
}

/** Leave, in the chat that joined: that agent knows which session it started. */
export function buildLeavePrompt(platform: PlatformId): string {
  return `Use the \`${PLATFORMS[platform].tool}\` tool with action "leave" for this meeting. Reply with the result only.`
}

/**
 * Stop a live session JoaxClaw didn't start. A meeting-plugin session leaves through its
 * tool, by link; a Discord capture stops through the transcripts tool (which only its
 * owning agent may use).
 */
export function buildStopPrompt(s: Pick<TranscriptSession, 'providerId' | 'selector' | 'source'>): string {
  const platform = platformForProvider(s.providerId)
  if (platform && s.source.meetingUrl) {
    return `Use the \`${PLATFORMS[platform].tool}\` tool with action "leave" for the meeting at "${s.source.meetingUrl}". Reply with the result only.`
  }
  return `Use the transcripts tool with action "stop" and selector "${s.selector}". Reply with the result only.`
}

/** The meeting platform whose plugin files notes under this transcript provider. */
export function platformForProvider(providerId: string): PlatformId | null {
  const id = canonicalProvider(providerId)
  return PLATFORM_LIST.find(p => p.providerId === id)?.id ?? null
}

// ── Recording: the join's tool result ──────────────────────────────────────────

/** What a meeting tool call in the joining chat says. */
export interface JoinOutcome {
  kind: 'running' | 'ok' | 'manual' | 'error'
  text: string
}

interface ToolCallLike { name: string; args?: string; result?: string; status: string; error?: string }

/**
 * Read the plugin's tool result. Its shape is plugin-defined; the documented part is a
 * `manualAction: { reason, message }` when a person has to do something in Chrome (sign
 * in, admit from the lobby, allow a permission). Anything unrecognised is shown as text.
 */
export function parseMeetingToolResult(call: ToolCallLike): JoinOutcome {
  if (call.status === 'pending' || call.status === 'running') return { kind: 'running', text: '' }
  if (call.status === 'error') return { kind: 'error', text: (call.error ?? call.result ?? 'The tool failed.').trim() }
  const raw = (call.result ?? '').trim()
  let obj: Record<string, unknown> | null = null
  try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) obj = v as Record<string, unknown> } catch { /* plain text */ }
  if (obj) {
    const manual = obj.manualAction as { message?: unknown; reason?: unknown } | undefined
    if (manual && typeof manual === 'object') {
      const msg = typeof manual.message === 'string' && manual.message.trim() ? manual.message.trim()
        : typeof manual.reason === 'string' ? manual.reason : 'Something needs doing in Chrome.'
      return { kind: 'manual', text: msg }
    }
    if (obj.ok === false || typeof obj.error === 'string') {
      return { kind: 'error', text: typeof obj.error === 'string' ? obj.error : raw }
    }
    return { kind: 'ok', text: raw }
  }
  if (raw.includes(TOOL_MISSING)) return { kind: 'error', text: "The agent doesn't have the meeting tool." }
  return { kind: 'ok', text: raw }
}

/** The action a meeting tool call was asked to take ("join", "leave"…), from its args. */
export function toolAction(call: Pick<ToolCallLike, 'args'>): string | null {
  try { const a = JSON.parse(call.args ?? '') as { action?: unknown }; return typeof a.action === 'string' ? a.action : null } catch { return null }
}

// ── Recording: pending joins ───────────────────────────────────────────────────

/** A join started from here, until it becomes a live session (or fails). */
export interface PendingJoin {
  id: string
  convId: string
  url: string
  platform: PlatformId
  agentId: string
  startedAt: number
  /** When the tool said OK; three minutes later with no live session it warns. */
  okAt?: number
  /** The live session it became. */
  selector?: string
  /** Stop was pressed. */
  stoppingAt?: number
}

export type PendingPhase = 'joining' | 'manual' | 'recording' | 'noNotes' | 'failed' | 'stopping' | 'unknown' | 'done'

export const NO_NOTES_AFTER_MS = 3 * 60_000

/**
 * Where a pending join is, from its chat and the gateway's live sessions.
 * - `join` is the latest join tool call's outcome, or null when the chat has none yet;
 *   `replyText` is the agent's finished reply when it answered without calling the tool.
 * - `hasStatus` is false on 2026.8 (no `transcripts.status`): an OK result is then
 *   taken at its word, with no live-session check.
 */
export function pendingPhase(p: PendingJoin, a: {
  join: JoinOutcome | null
  replyText?: string | null
  chatKnown: boolean
  active: TranscriptSession[]
  hasStatus: boolean
  leaveDone?: boolean
  now: number
}): { phase: PendingPhase; text?: string; selector?: string } {
  const match = matchActiveSession(p.url, a.active)
  if (p.stoppingAt) {
    const stillLive = p.selector ? a.active.some(s => s.selector === p.selector && s.active) : !!match
    if (!stillLive && (a.hasStatus || a.leaveDone)) return { phase: 'done' }
    return { phase: 'stopping', ...(p.selector ? { selector: p.selector } : {}) }
  }
  if (match) return { phase: 'recording', selector: match.selector }
  if (!a.join) {
    if (a.replyText?.trim()) {
      const t = a.replyText.trim()
      return { phase: 'failed', text: t.includes(TOOL_MISSING) ? "The agent doesn't have the meeting tool." : t }
    }
    // A chat that isn't here (after a reload, before its history loads) is unknown,
    // except right after the join was sent, while the chat is still being created.
    return a.chatKnown || a.now - p.startedAt < 60_000 ? { phase: 'joining' } : { phase: 'unknown' }
  }
  switch (a.join.kind) {
    case 'running': return { phase: 'joining' }
    case 'manual': return { phase: 'manual', text: a.join.text }
    case 'error': return { phase: 'failed', text: a.join.text }
    case 'ok':
      if (!a.hasStatus) return { phase: 'recording' }
      if (p.okAt !== undefined && a.now - p.okAt >= NO_NOTES_AFTER_MS) return { phase: 'noNotes' }
      return { phase: 'recording' }
  }
}

// ── Setup checklist ──────────────────────────────────────────────────────────

export type PluginReadiness = 'ready' | 'off' | 'error' | 'missing'

/**
 * A meeting plugin's state from plugins.list, cross-checked with the transcript
 * provider's availability. An uninstalled meeting plugin usually isn't in the list at
 * all (it has no catalog metadata), so absent means not installed.
 */
export function pluginReadiness(listResult: unknown, providers: TranscriptStatus['providers'] | undefined, platform: Platform): { state: PluginReadiness; error?: string } {
  const rows = (listResult as { plugins?: unknown } | null)?.plugins
  const row = (Array.isArray(rows) ? rows : []).find(r => (r as { id?: unknown })?.id === platform.pluginId) as
    { installed?: boolean; enabled?: boolean; state?: string; error?: string } | undefined
  if (!row || row.installed === false || row.state === 'not-installed') return { state: 'missing' }
  if (row.state === 'error') return { state: 'error', ...(row.error ? { error: row.error } : {}) }
  if (row.state === 'disabled' || row.enabled === false) return { state: 'off' }
  const provider = providers?.find(p => canonicalProvider(p.providerId) === platform.providerId)
  if (provider?.availability === 'unavailable') return { state: 'error' }
  if (provider?.availability === 'disabled') return { state: 'off' }
  return { state: 'ready' }
}

export interface ChromeCheck { checkedAt: number; convId?: string; ok?: boolean }

/**
 * The checklist is complete when notes are on and at least one meeting plugin is ready.
 * Chrome and Discord are informative only: neither can be verified over RPC.
 */
export function checklistState(capture: boolean | null, plugins: Record<PlatformId, PluginReadiness>): { captureOn: boolean; ready: PlatformId[]; complete: boolean } {
  const ready = (Object.keys(plugins) as PlatformId[]).filter(id => plugins[id] === 'ready')
  const captureOn = capture === true
  return { captureOn, ready, complete: captureOn && ready.length > 0 }
}

/** When a read was sent, and on which connection (gatewayClient.connectionSeq). */
export interface ReadStamp { seq: number; atMs: number }

export interface CaptureInputs {
  /** `transcripts.status`'s `enabled`, and when it was read. */
  status: ({ value: boolean } & ReadStamp) | null
  /** `transcripts.enabled` from config.get (2026.8 has no status), and when it was read. */
  config: ({ value: boolean } & ReadStamp) | null
  /** The connection now showing. */
  connectionSeq: number
  /** Notes were turned on from here: when the change was accepted, and on which connection. */
  requested: ReadStamp | null
}

/**
 * Whether meeting notes are on, for the checklist: true, false, or null for "checking".
 *
 * Only a read taken on the current connection counts. Turning notes on restarts the
 * gateway, and for the moment between the reconnect and the first fresh read, the
 * previous connection's status still said "off" (QA: the checklist flashed "Meeting notes
 * are off" for ~2 s after turning them on). A read from an earlier connection is stale by
 * definition, so it is never shown: the answer is "checking" until a fresh one arrives.
 *
 * Once turned on from here, the intended state (on) shows until a read confirms or
 * contradicts it. A read taken before the change was accepted can't; nor can an "off"
 * from the same connection, since the old process keeps saying off until its restart.
 * A fresh read after the restart is the gateway's word, whichever way it goes.
 */
export function captureState(i: CaptureInputs): boolean | null {
  const counts = (r: CaptureInputs['status']): r is NonNullable<CaptureInputs['status']> => {
    if (!r || r.seq !== i.connectionSeq) return false
    const req = i.requested
    if (!req) return true
    return r.atMs >= req.atMs && (r.seq > req.seq || r.value)
  }
  if (counts(i.status)) return i.status.value
  if (counts(i.config)) return i.config.value
  return i.requested ? true : null
}

/** `transcripts.enabled` from a config snapshot. Absent means on (the default). */
export function captureFromConfig(config: unknown): boolean {
  const t = (config as { transcripts?: { enabled?: unknown } } | null)?.transcripts
  return t?.enabled !== false
}

/** The guest name a Teams/Zoom/Meet join types in, from the plugin's config. */
export const DEFAULT_GUEST_NAME = 'OpenClaw Agent'
export function guestNameFromConfig(config: unknown, platform: Platform): string {
  const entry = (config as { plugins?: { entries?: Record<string, { config?: { chrome?: { guestName?: unknown } } }> } } | null)
    ?.plugins?.entries?.[platform.pluginId]
  const name = entry?.config?.chrome?.guestName
  return typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_GUEST_NAME
}

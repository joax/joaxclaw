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
  /** The plugin's runtime id, for plugins.list and plugins.install { source: "official" }. */
  pluginId: string
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
    id: 'meet', label: 'Google Meet', pluginId: 'google-meet', tool: 'google_meet', providerId: 'google-meet',
    npm: '@openclaw/google-meet', setupCommand: 'openclaw googlemeet setup --json', pluginName: 'Google Meet',
  },
  teams: {
    id: 'teams', label: 'Teams', pluginId: 'teams-meetings', tool: 'teams_meetings', providerId: 'teams',
    npm: '@openclaw/teams-meetings', setupCommand: 'openclaw teamsmeetings setup', pluginName: 'Teams meetings',
  },
  zoom: {
    id: 'zoom', label: 'Zoom', pluginId: 'zoom-meetings', tool: 'zoom_meetings', providerId: 'zoom',
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

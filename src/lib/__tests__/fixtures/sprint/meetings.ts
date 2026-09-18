// Payload fixtures for PRD 07 (Meetings), QA sprint 2026.9.
// Source of truth: OpenClaw 2026.9.4 compiled package (dist/…). Paths below are relative to
// the package root. Every interface cites the schema/handler that produces the shape.
//
// Key facts the shapes encode (see the QA report for the full list):
// - All transcript timestamps are ISO-8601 STRINGS (startedAt, stoppedAt, updatedAt, …), not ms.
// - A selector is `YYYY-MM-DD/<safe session id>` (dist/store-DsUNqEhh.mjs:47).
// - `source.meetingUrl` is projected as origin + pathname only — query (Zoom `pwd`) and
//   fragment are dropped (dist/source-locator-BSjIr0Fk.mjs:3, dist/read-D2MLpeDR.mjs:23).
// - No transcripts.* events exist (dist/server-methods-list-Bm-R-rqW.mjs:18 GATEWAY_EVENTS).
// - Errors: library errors are INVALID_REQUEST + details.type (dist/transcripts-BzXJGPO2.mjs:321).
// - Meeting-plugin tool results (google_meet / teams_meetings / zoom_meetings) come from external
//   npm packages that are NOT in the gateway package; those fixtures follow the docs only.
import type { ToolCall } from '../../../types'

// ─── Gateway shapes ──────────────────────────────────────────────────────────

/** dist/transcripts-M-a_ANB8.mjs:34 SourceKind */
export type TranscriptSourceKind = 'live-audio' | 'live-caption' | 'posthoc-transcript' | 'recording-stt'

/** dist/transcripts-M-a_ANB8.mjs:41 Source (closed object). Projected by dist/read-D2MLpeDR.mjs:9. */
export interface TranscriptSource {
  providerId: string
  kind?: TranscriptSourceKind
  accountId?: string
  guildId?: string
  channelId?: string
  /** origin + pathname only; omitted unless it starts with http(s):// (dist/read-D2MLpeDR.mjs:23) */
  meetingUrl?: string
  threadTs?: string
  fileId?: string
}

/** dist/transcripts-M-a_ANB8.mjs:51 TranscriptSessionSummarySchema; built at dist/read-D2MLpeDR.mjs:28 */
export interface TranscriptSessionSummary {
  selector: string
  sessionId: string
  title?: string
  providerId: string
  providerName?: string
  source: TranscriptSource
  /** ISO string (NonEmptyString) */
  startedAt: string
  stoppedAt?: string
  active: boolean
  utteranceCount: number
  participants: string[]
  hasSummary: boolean
  summarySource?: 'model' | 'heuristic'
  /** ≤ 280 UTF-16 units */
  overview?: string
  /** owning agent from session metadata, else null */
  agentId: string | null
  updatedAt: string
  lastUtteranceAt: string | null
  activeSubscription: boolean
}

/** dist/transcripts-M-a_ANB8.mjs:71 TranscriptUtteranceSchema; dist/read-D2MLpeDR.mjs:74 */
export interface TranscriptUtterance {
  sequence: number
  id?: string
  startedAt?: string
  endedAt?: string
  speakerId?: string
  speakerLabel?: string
  text: string
  final?: boolean
}

/** dist/transcripts-M-a_ANB8.mjs:111 summary; built by readTranscriptNotes dist/read-D2MLpeDR.mjs:56 */
export interface TranscriptStoredSummary {
  /** "" when the stored notes have markdown but no summary JSON */
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

/** dist/transcripts-M-a_ANB8.mjs:81 TranscriptsListParamsSchema (closed) */
export interface TranscriptsListParams {
  limit?: number // 1–200, default 50
  cursor?: string
  query?: string // maxLength 256 (no minLength)
  providerId?: string // NonEmptyString, exact match
  accountId?: string
  agentId?: string
  startedAfter?: string // date-time, inclusive
  startedBefore?: string // date-time, exclusive
}

/** dist/transcripts-M-a_ANB8.mjs:100 */
export interface TranscriptsListResult {
  sessions: TranscriptSessionSummary[]
  nextCursor: string | null
}

/** dist/transcripts-M-a_ANB8.mjs:104 (closed). No limit/cursor/query ⇒ "legacy" read (dist/transcripts-BzXJGPO2.mjs:109). */
export interface TranscriptsGetParams {
  selector: string
  includeUtterances?: boolean
  limit?: number // 1–100, default 50
  cursor?: string
  query?: string
}

/** dist/transcripts-M-a_ANB8.mjs:109; key `summary` absent when no notes, `utterances` absent unless includeUtterances */
export interface TranscriptsGetResult {
  session: TranscriptSessionSummary
  summary?: TranscriptStoredSummary
  utterances?: TranscriptUtterance[]
  nextCursor: string | null
}

/** dist/transcripts-M-a_ANB8.mjs:126 */
export interface TranscriptsExportParams {
  selector: string
  format: 'markdown' | 'jsonl'
}

/** dist/transcripts-M-a_ANB8.mjs:130; values from dist/transcripts-BzXJGPO2.mjs:166-175 */
export interface TranscriptsExportResult {
  selector: string
  /** `transcript-<YYYY-MM-DD>-<sha256(selector)[0:12]>.md|jsonl` */
  filename: string
  /** "text/markdown;charset=utf-8" | "application/x-ndjson;charset=utf-8" */
  mimeType: string
  encoding: 'base64'
  data: string
  /** ≤ 4194304 */
  sizeBytes: number
}

/** dist/transcripts-M-a_ANB8.mjs:144 provider entry; built at dist/transcripts-BzXJGPO2.mjs:190-232 */
export interface TranscriptProviderStatus {
  providerId: string
  pluginId?: string
  name: string
  availability: 'enabled' | 'disabled' | 'unavailable' | 'unknown'
  sourceKinds?: TranscriptSourceKind[]
  canStart?: boolean
  canStop?: boolean
  canImport?: boolean
  autoStart?: {
    accountId?: 'optional' | 'required'
    guildId?: 'optional' | 'required'
    channelId?: 'optional' | 'required'
    meetingUrl?: 'optional' | 'required'
  }
}

/** dist/transcripts-M-a_ANB8.mjs:176 — NB: an enum only, there is no hint/message string */
export type TranscriptStartDiagnostic =
  | 'starting'
  | 'retrying'
  | 'id-conflict'
  | 'admitted-start-failed'
  | 'start-failed'
  | 'ended'

/** dist/transcripts-M-a_ANB8.mjs:165; built at dist/transcripts-BzXJGPO2.mjs:247-285 */
export interface TranscriptConfiguredSource {
  source: TranscriptSource
  title?: string
  sessionId?: string
  state: 'disabled' | 'armed' | 'not-active' | 'unknown'
  activeSelectors: string[]
  startDiagnostic?: TranscriptStartDiagnostic
}

/** dist/transcripts-M-a_ANB8.mjs:142 TranscriptsStatusResultSchema; params = {} (closed) */
export interface TranscriptsStatusResult {
  enabled: boolean
  providers: TranscriptProviderStatus[]
  configuredSources: TranscriptConfiguredSource[]
  active: TranscriptSessionSummary[]
  latestTranscript: TranscriptSessionSummary | null
  omitted: { providers: number; configuredSources: number; active: number }
}

/** errorShape() dist/error-codes-C3Z5XSDw.mjs:65; codes dist/gateway-error-details-Brpdn9L1.mjs:6 */
export interface GatewayErrorShape {
  code: 'INVALID_REQUEST' | 'FORBIDDEN' | 'UNAVAILABLE' | string
  message: string
  details?: Record<string, unknown>
  retryable?: boolean
  retryAfterMs?: number
}

/** Response frame dist/message-handler-BBAGn2rf.mjs:321 */
export interface GatewayResFrame<T> {
  type: 'res'
  id: string
  ok: boolean
  payload?: T
  error?: GatewayErrorShape
}

/** TranscriptLibraryError types dist/transcripts-BzXJGPO2.mjs:39,44,49,70,118; dist/store-DsUNqEhh.mjs:361,368 */
export type TranscriptLibraryErrorType =
  | 'transcript_invalid_cursor'
  | 'transcript_invalid_filter'
  | 'transcript_session_not_found'
  | 'transcript_result_too_large'
  | 'transcript_export_too_large'

/** config `transcripts` block — dist/zod-schema-Q1KXOooO.mjs:1446 (strict; strings min(1)) */
export interface TranscriptsConfigBlock {
  enabled?: boolean
  autoStart?: TranscriptsAutoStartEntry[]
}

/** dist/zod-schema-Q1KXOooO.mjs:1448 */
export interface TranscriptsAutoStartEntry {
  providerId: string
  whenOccupied?: boolean
  sessionId?: string
  title?: string
  accountId?: string
  guildId?: string
  channelId?: string
  meetingUrl?: string
}

/** plugins.list entry dist/sessions-rlbLHLas.mjs:118 PluginCatalogEntrySchema (subset used by the checklist) */
export interface PluginCatalogEntryLite {
  id: string
  name: string
  packageName?: string
  version?: string
  origin?: string
  installed: boolean
  enabled: boolean
  state: 'enabled' | 'disabled' | 'needs-setup' | 'not-installed' | 'error'
  install?: { source: 'official'; pluginId: string } | { source: 'clawhub'; packageName: string }
  error?: string
  removable?: boolean
}

/** dist/sessions-rlbLHLas.mjs:157 */
export interface PluginsListResultLite {
  plugins: PluginCatalogEntryLite[]
  diagnostics: unknown[]
  mutationAllowed: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function utf8Len(text: string): number {
  return new TextEncoder().encode(text).length
}

// ─── Sessions (Summary rows) ────────────────────────────────────────────────

/** Finished Google Meet with a model summary. 42 min, 5 people. */
export const SESSION_MEET_DONE: TranscriptSessionSummary = {
  selector: '2026-09-14/meet_7f3a2c91',
  sessionId: 'meet_7f3a2c91',
  title: 'Weekly product sync',
  providerId: 'google-meet',
  providerName: 'Google Meet',
  source: { providerId: 'google-meet', kind: 'live-caption', meetingUrl: 'https://meet.google.com/abc-defg-hij' },
  startedAt: '2026-09-14T10:00:04.112Z',
  stoppedAt: '2026-09-14T10:42:31.870Z',
  active: false,
  utteranceCount: 318,
  participants: ['Ana Ruiz', 'Ben Okafor', 'Chloe Martin', 'Dev Patel', 'Joaquin'],
  hasSummary: true,
  summarySource: 'model',
  overview: 'Agreed to ship the pricing page Thursday and move the onboarding survey to next sprint.',
  agentId: 'main',
  updatedAt: '2026-09-14T10:42:40.021Z',
  lastUtteranceAt: '2026-09-14T10:42:29.500Z',
  activeSubscription: false,
}

/** Zoom, heuristic notes, title absent (UI must fall back to "{Provider} meeting"), providerName absent. */
export const SESSION_ZOOM_HEURISTIC_UNTITLED: TranscriptSessionSummary = {
  selector: '2026-09-11/zoom_81234567890_1789125600',
  sessionId: 'zoom_81234567890_1789125600',
  providerId: 'zoom',
  // meetingUrl projected WITHOUT ?pwd=… (dist/source-locator-BSjIr0Fk.mjs:10)
  source: { providerId: 'zoom', kind: 'live-caption', meetingUrl: 'https://acme.zoom.us/j/81234567890' },
  startedAt: '2026-09-11T15:00:00.000Z',
  stoppedAt: '2026-09-11T15:28:12.004Z',
  active: false,
  utteranceCount: 96,
  participants: ['Customer (guest)', 'Joaquin', 'Priya'],
  hasSummary: true,
  summarySource: 'heuristic',
  overview: 'Onboarding call: customer asked for SSO and a CSV import.',
  agentId: 'ops',
  updatedAt: '2026-09-11T15:28:20.300Z',
  lastUtteranceAt: '2026-09-11T15:28:10.000Z',
  activeSubscription: false,
}

/** Teams meeting that captured nothing (captions off) → "No speech" pill; no summary. */
export const SESSION_TEAMS_NO_SPEECH: TranscriptSessionSummary = {
  selector: '2026-09-10/teams_19meeting_ZmQ1',
  sessionId: 'teams_19meeting_ZmQ1',
  title: 'Vendor check-in',
  providerId: 'teams',
  providerName: 'Microsoft Teams meetings',
  source: {
    providerId: 'teams',
    kind: 'live-caption',
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmQ1%40thread.v2/0',
  },
  startedAt: '2026-09-10T09:00:00.000Z',
  stoppedAt: '2026-09-10T09:03:40.000Z',
  active: false,
  utteranceCount: 0,
  participants: [],
  hasSummary: false,
  agentId: 'main',
  updatedAt: '2026-09-10T09:03:40.000Z',
  lastUtteranceAt: null,
  activeSubscription: false,
}

/** Live Google Meet (Recording pill). No stoppedAt; summary not yet written. */
export const SESSION_MEET_ACTIVE: TranscriptSessionSummary = {
  selector: '2026-09-18/meet_c0ffee42',
  sessionId: 'meet_c0ffee42',
  title: 'Design review',
  providerId: 'google-meet',
  providerName: 'Google Meet',
  source: { providerId: 'google-meet', kind: 'live-caption', meetingUrl: 'https://meet.google.com/xyz-abcd-efg' },
  startedAt: '2026-09-18T02:41:00.000Z',
  active: true,
  utteranceCount: 57,
  participants: ['Joaquin', 'Mara Lind'],
  hasSummary: false,
  agentId: 'main',
  updatedAt: '2026-09-18T02:53:10.000Z',
  lastUtteranceAt: '2026-09-18T02:53:08.000Z',
  activeSubscription: true,
}

/** Older active Meet session on the SAME url (matchActiveSession must pick the newest startedAt). */
export const SESSION_MEET_ACTIVE_OLDER_SAME_URL: TranscriptSessionSummary = {
  ...SESSION_MEET_ACTIVE,
  selector: '2026-09-18/meet_c0ffee41',
  sessionId: 'meet_c0ffee41',
  startedAt: '2026-09-18T01:10:00.000Z',
  utteranceCount: 3,
  updatedAt: '2026-09-18T01:12:00.000Z',
  lastUtteranceAt: '2026-09-18T01:11:30.000Z',
}

/** Discord occupancy capture; no meetingUrl, has guild/channel. */
export const SESSION_DISCORD_DONE: TranscriptSessionSummary = {
  selector: '2026-09-17/discord-voice-1122334455667788-9',
  sessionId: 'discord-voice-1122334455667788-9',
  title: 'Standup voice',
  providerId: 'discord-voice',
  providerName: 'Discord voice',
  source: { providerId: 'discord-voice', kind: 'live-audio', accountId: 'work', guildId: '1234567890', channelId: '2345678901' },
  startedAt: '2026-09-17T08:59:31.000Z',
  stoppedAt: '2026-09-17T09:16:02.000Z',
  active: false,
  utteranceCount: 140,
  participants: ['joax', 'mira', 'tomasz'],
  hasSummary: true,
  summarySource: 'model',
  overview: 'Standup: API freeze Friday; tomasz blocked on staging creds.',
  agentId: null,
  updatedAt: '2026-09-17T09:16:30.000Z',
  lastUtteranceAt: '2026-09-17T09:15:58.000Z',
  activeSubscription: false,
}

/** Imported transcript (manual provider) — no summary yet, Summarize applies. Only optional fields absent. */
export const SESSION_IMPORTED_NO_SUMMARY: TranscriptSessionSummary = {
  selector: '2026-09-16/board-prep',
  sessionId: 'board-prep',
  title: 'Board prep (imported)',
  providerId: 'manual-transcript',
  providerName: 'Manual Transcript Import',
  source: { providerId: 'manual-transcript', kind: 'posthoc-transcript' },
  startedAt: '2026-09-16T17:00:00.000Z',
  stoppedAt: '2026-09-16T17:00:01.000Z',
  active: false,
  utteranceCount: 42,
  participants: ['Speaker'],
  hasSummary: false,
  agentId: 'main',
  updatedAt: '2026-09-16T17:00:01.000Z',
  lastUtteranceAt: '2026-09-16T17:00:00.000Z',
  activeSubscription: false,
}

/** Session whose selector date is not the local date (UTC midnight edge), duration > 1 h. */
export const SESSION_OVER_ONE_HOUR: TranscriptSessionSummary = {
  ...SESSION_MEET_DONE,
  selector: '2026-09-15/meet_late_night',
  sessionId: 'meet_late_night',
  title: 'All-hands (APAC)',
  startedAt: '2026-09-15T23:30:00.000Z',
  stoppedAt: '2026-09-16T01:05:00.000Z',
  overview: 'x'.repeat(280), // at the overview cap
}

// ─── transcripts.list ───────────────────────────────────────────────────────

export const LIST_PARAMS_FIRST_PAGE: TranscriptsListParams = { limit: 50 }
export const LIST_PARAMS_SEARCH: TranscriptsListParams = { limit: 50, query: 'pricing' }
export const LIST_PARAMS_PROVIDER: TranscriptsListParams = { limit: 50, providerId: 'zoom' }

/** Cursor = base64url(JSON [1, sha256(scope), startedAt, sessionId]) — opaque; dist/transcripts-BzXJGPO2.mjs:25 */
export const LIST_NEXT_CURSOR = 'WzEsIjNmOWM0ZTAxYjJkNyIsIjIwMjYtMDktMTBUMDk6MDA6MDAuMDAwWiIsInRlYW1zXzE5bWVldGluZ19abVExIl0'

/** Newest-first page with more to load. */
export const LIST_RESULT_PAGE1: TranscriptsListResult = {
  sessions: [
    SESSION_MEET_ACTIVE,
    SESSION_DISCORD_DONE,
    SESSION_IMPORTED_NO_SUMMARY,
    SESSION_MEET_DONE,
    SESSION_ZOOM_HEURISTIC_UNTITLED,
    SESSION_TEAMS_NO_SPEECH,
  ],
  nextCursor: LIST_NEXT_CURSOR,
}

export const LIST_RESULT_LAST_PAGE: TranscriptsListResult = {
  sessions: [SESSION_OVER_ONE_HOUR],
  nextCursor: null,
}

export const LIST_RESULT_EMPTY: TranscriptsListResult = { sessions: [], nextCursor: null }

// ─── transcripts.get ────────────────────────────────────────────────────────

export const SUMMARY_MODEL: TranscriptStoredSummary = {
  generatedAt: '2026-09-14T10:42:39.000Z',
  overview: 'Agreed to ship the pricing page Thursday and move the onboarding survey to next sprint.',
  decisions: ['Pricing page ships Thursday', 'Survey moves to sprint 38'],
  actionItems: ['Update the pricing copy (Ana)', 'Draft survey questions (Dev)'],
  risks: ['Legal review of the pricing copy may slip'],
  participants: ['Ana Ruiz', 'Ben Okafor', 'Chloe Martin', 'Dev Patel', 'Joaquin'],
  source: 'model',
  model: 'anthropic/claude-haiku-4-5',
  markdown:
    '# Weekly product sync\n\n## Overview\nAgreed to ship the pricing page Thursday and move the onboarding survey to next sprint.\n\n## Decisions\n- Pricing page ships Thursday\n- Survey moves to sprint 38\n\n## Action items\n- Update the pricing copy (Ana)\n- Draft survey questions (Dev)\n\n## Risks\n- Legal review of the pricing copy may slip\n',
  utteranceCount: 318,
}

export const SUMMARY_HEURISTIC: TranscriptStoredSummary = {
  generatedAt: '2026-09-11T15:28:19.000Z',
  overview: 'Onboarding call: customer asked for SSO and a CSV import.',
  decisions: [],
  actionItems: ['Send SSO docs'],
  risks: [],
  participants: ['Customer (guest)', 'Joaquin', 'Priya'],
  source: 'heuristic',
  markdown: '# Transcript\n\n## Overview\nOnboarding call: customer asked for SSO and a CSV import.\n\n## Action items\n- Send SSO docs\n',
  utteranceCount: 96,
}

/** Older notes: markdown exists but no summary JSON → defaults filled (dist/read-D2MLpeDR.mjs:60-70). */
export const SUMMARY_LEGACY_MARKDOWN_ONLY: TranscriptStoredSummary = {
  generatedAt: '',
  overview: '',
  decisions: [],
  actionItems: [],
  risks: [],
  participants: [],
  utteranceCount: 0,
  markdown: '# Standup voice\n\nNotes written before summary metadata existed.\n',
}

/** FR-3 summary read: `{ selector }` only (legacy purpose; no utterances key). */
export const GET_PARAMS_SUMMARY: TranscriptsGetParams = { selector: SESSION_MEET_DONE.selector }
export const GET_RESULT_WITH_SUMMARY: TranscriptsGetResult = {
  session: SESSION_MEET_DONE,
  nextCursor: null,
  summary: SUMMARY_MODEL,
}

/** No stored summary: the `summary` key is absent (undefined is dropped by JSON). */
export const GET_RESULT_NO_SUMMARY: TranscriptsGetResult = {
  session: SESSION_IMPORTED_NO_SUMMARY,
  nextCursor: null,
}

/** Summarize flow: the poll that finally sees the summary. */
export const GET_RESULT_AFTER_SUMMARIZE: TranscriptsGetResult = {
  session: { ...SESSION_IMPORTED_NO_SUMMARY, hasSummary: true, summarySource: 'model', overview: 'Board prep: runway, hiring plan.' },
  nextCursor: null,
  summary: {
    ...SUMMARY_MODEL,
    overview: 'Board prep: runway, hiring plan.',
    decisions: [],
    actionItems: ['Finalize hiring plan slide'],
    risks: [],
    participants: ['Speaker'],
    markdown: '# Board prep (imported)\n\n## Overview\nBoard prep: runway, hiring plan.\n',
    utteranceCount: 42,
  },
}

/** FR-3 transcript page: explicit limit always sent. */
export const GET_PARAMS_UTTERANCES: TranscriptsGetParams = {
  selector: SESSION_MEET_DONE.selector,
  includeUtterances: true,
  limit: 50,
}

/** Cursor = base64url(JSON [1, sha256(["get", selector, query]), lastSequence]) */
export const GET_NEXT_CURSOR = 'WzEsIjk5YWJjZGVmMDEyMyIsNDldfQ'

export const UTTERANCES_PAGE1: TranscriptUtterance[] = [
  { sequence: 0, id: 'cap-0001', startedAt: '2026-09-14T10:00:11.000Z', endedAt: '2026-09-14T10:00:14.200Z', speakerId: 'spk-ana', speakerLabel: 'Ana Ruiz', text: 'Morning everyone, let us start with pricing.', final: true },
  { sequence: 1, id: 'cap-0002', startedAt: '2026-09-14T10:00:15.000Z', speakerLabel: 'Ben Okafor', text: 'Copy is ready; legal still has it.', final: true },
  // speaker and times absent (optional fields)
  { sequence: 2, text: 'Can we ship Thursday?' },
]

export const GET_RESULT_UTTERANCES_PAGE1: TranscriptsGetResult = {
  session: SESSION_MEET_DONE,
  summary: SUMMARY_MODEL,
  utterances: UTTERANCES_PAGE1,
  nextCursor: GET_NEXT_CURSOR,
}

export const GET_RESULT_UTTERANCES_LAST: TranscriptsGetResult = {
  session: SESSION_MEET_DONE,
  summary: SUMMARY_MODEL,
  utterances: [{ sequence: 317, id: 'cap-0318', speakerLabel: 'Joaquin', text: 'Thanks all.', final: true }],
  nextCursor: null,
}

/** includeUtterances on a no-speech meeting: empty array, not absent. */
export const GET_RESULT_UTTERANCES_EMPTY: TranscriptsGetResult = {
  session: SESSION_TEAMS_NO_SPEECH,
  utterances: [],
  nextCursor: null,
}

/** Search within transcript (cursor must reset when query changes — cursor scope includes query). */
export const GET_PARAMS_UTTERANCES_SEARCH: TranscriptsGetParams = {
  selector: SESSION_MEET_DONE.selector,
  includeUtterances: true,
  limit: 50,
  query: 'Thursday',
}

// ─── transcripts.export ─────────────────────────────────────────────────────

export const EXPORT_PARAMS_MD: TranscriptsExportParams = { selector: SESSION_MEET_DONE.selector, format: 'markdown' }
export const EXPORT_PARAMS_JSONL: TranscriptsExportParams = { selector: SESSION_MEET_DONE.selector, format: 'jsonl' }

const EXPORT_MD_BODY = `${SUMMARY_MODEL.markdown}\n\nSummary covers 318 saved utterances.\n\n## Full Transcript\n- Ana Ruiz: Morning everyone, let us start with pricing.\n- Ben Okafor: Copy is ready; legal still has it.\n- Can we ship Thursday?\n\nTranscript utterances: 318\n`
const EXPORT_JSONL_BODY = UTTERANCES_PAGE1.map(u => `${JSON.stringify(u)}\n`).join('')

/** dist/transcripts-BzXJGPO2.mjs:167-175 */
export const EXPORT_RESULT_MD: TranscriptsExportResult = {
  selector: SESSION_MEET_DONE.selector,
  filename: 'transcript-2026-09-14-4b1d2a9c07e3.md',
  mimeType: 'text/markdown;charset=utf-8',
  encoding: 'base64',
  data: b64(EXPORT_MD_BODY),
  sizeBytes: utf8Len(EXPORT_MD_BODY),
}

export const EXPORT_RESULT_JSONL: TranscriptsExportResult = {
  selector: SESSION_MEET_DONE.selector,
  filename: 'transcript-2026-09-14-4b1d2a9c07e3.jsonl',
  mimeType: 'application/x-ndjson;charset=utf-8',
  encoding: 'base64',
  data: b64(EXPORT_JSONL_BODY),
  sizeBytes: utf8Len(EXPORT_JSONL_BODY),
}

/** Non-ASCII body: decoded bytes must round-trip UTF-8 (atob → Uint8Array, not string). */
const EXPORT_UTF8_BODY = '# Reunión\n\n- Zoë: ¿Listos? ✅\n'
export const EXPORT_RESULT_UTF8: TranscriptsExportResult = {
  selector: '2026-09-12/meet_es_01',
  filename: 'transcript-2026-09-12-a0b1c2d3e4f5.md',
  mimeType: 'text/markdown;charset=utf-8',
  encoding: 'base64',
  data: b64(EXPORT_UTF8_BODY),
  sizeBytes: utf8Len(EXPORT_UTF8_BODY),
}
export const EXPORT_UTF8_EXPECTED_TEXT = EXPORT_UTF8_BODY

/** Exact cap. */
export const TRANSCRIPTS_EXPORT_MAX_BYTES = 4194304 // dist/transcripts-M-a_ANB8.mjs:9
export const TRANSCRIPTS_RESULT_MAX_BYTES = 1048576 // dist/transcripts-M-a_ANB8.mjs:8
export const TRANSCRIPTS_PAGE_MAX = 100 // dist/transcripts-M-a_ANB8.mjs:6
export const TRANSCRIPTS_LIST_MAX = 200 // dist/transcripts-M-a_ANB8.mjs:7

// ─── transcripts.status ─────────────────────────────────────────────────────

/** Always registered core provider (dist/capture-operations-C3GUtHCd.mjs:197; dist/transcripts-BzXJGPO2.mjs:202). */
export const PROVIDER_MANUAL: TranscriptProviderStatus = {
  providerId: 'manual-transcript',
  name: 'Manual Transcript Import',
  availability: 'enabled',
  sourceKinds: ['posthoc-transcript'],
  canStart: false,
  canStop: false,
  canImport: true,
}

/** Fresh gateway, no meeting plugins, no Discord: only the manual provider. Capture on by default. */
export const STATUS_FRESH: TranscriptsStatusResult = {
  enabled: true,
  providers: [PROVIDER_MANUAL],
  configuredSources: [],
  active: [],
  latestTranscript: null,
  omitted: { providers: 0, configuredSources: 0, active: 0 },
}

/** Capture off (transcripts.enabled: false). */
export const STATUS_CAPTURE_OFF: TranscriptsStatusResult = { ...STATUS_FRESH, enabled: false }

export const PROVIDER_GOOGLE_MEET_ENABLED: TranscriptProviderStatus = {
  providerId: 'google-meet',
  pluginId: 'google-meet',
  name: 'Google Meet',
  availability: 'enabled',
  sourceKinds: ['live-caption'],
  canStart: false,
  canStop: true,
  canImport: false,
}

export const PROVIDER_ZOOM_DISABLED: TranscriptProviderStatus = {
  providerId: 'zoom',
  pluginId: 'zoom-meetings',
  name: 'Zoom meetings',
  availability: 'disabled',
}

export const PROVIDER_TEAMS_ERROR: TranscriptProviderStatus = {
  providerId: 'teams',
  pluginId: 'teams-meetings',
  name: 'Microsoft Teams meetings',
  availability: 'unavailable',
}

export const PROVIDER_DISCORD_VOICE: TranscriptProviderStatus = {
  providerId: 'discord-voice',
  pluginId: 'discord',
  name: 'Discord voice',
  availability: 'enabled',
  sourceKinds: ['live-audio'],
  canStart: true,
  canStop: true,
  canImport: false,
  autoStart: { accountId: 'optional', guildId: 'required', channelId: 'required' },
}

/** Meet installed + live recording; Zoom disabled; Teams failed to load; Discord armed + a failed entry. */
export const STATUS_BUSY: TranscriptsStatusResult = {
  enabled: true,
  providers: [PROVIDER_DISCORD_VOICE, PROVIDER_GOOGLE_MEET_ENABLED, PROVIDER_MANUAL, PROVIDER_TEAMS_ERROR, PROVIDER_ZOOM_DISABLED],
  configuredSources: [
    {
      source: { providerId: 'discord-voice', accountId: 'work', guildId: '1234567890', channelId: '2345678901' },
      title: 'Standup voice',
      state: 'armed',
      activeSelectors: ['2026-09-18/discord-voice-1122334455667788-10'],
    },
    {
      source: { providerId: 'discord-voice', guildId: '99887766', channelId: '55443322' },
      state: 'not-active',
      activeSelectors: [],
      startDiagnostic: 'start-failed',
    },
    {
      source: { providerId: 'discord-voice', guildId: '111', channelId: '222' },
      state: 'unknown',
      activeSelectors: [],
      startDiagnostic: 'retrying',
    },
  ],
  active: [SESSION_MEET_ACTIVE],
  latestTranscript: SESSION_MEET_ACTIVE,
  omitted: { providers: 0, configuredSources: 0, active: 0 },
}

/** Two actives on the same (sanitized) meeting URL. */
export const STATUS_TWO_ACTIVE_SAME_URL: TranscriptsStatusResult = {
  ...STATUS_BUSY,
  active: [SESSION_MEET_ACTIVE_OLDER_SAME_URL, SESSION_MEET_ACTIVE],
}

/** Capture off: every configured source reports "disabled" (dist/transcripts-BzXJGPO2.mjs:281). */
export const STATUS_OFF_WITH_SOURCES: TranscriptsStatusResult = {
  ...STATUS_BUSY,
  enabled: false,
  configuredSources: STATUS_BUSY.configuredSources.map(s => ({ ...s, state: 'disabled' as const, activeSelectors: [] })),
  active: [],
}

/** Truncated lists (>100). */
export const STATUS_OMITTED: TranscriptsStatusResult = {
  ...STATUS_BUSY,
  omitted: { providers: 0, configuredSources: 3, active: 12 },
}

// ─── Error payloads (res.error) ─────────────────────────────────────────────

function libraryError(type: TranscriptLibraryErrorType, message: string, maxBytes?: number): GatewayErrorShape {
  return { code: 'INVALID_REQUEST', message, details: { type, ...(maxBytes !== undefined ? { maxBytes } : {}) } }
}

export const ERR_INVALID_CURSOR = libraryError('transcript_invalid_cursor', 'Invalid transcript cursor; restart pagination with the current filters.')
/** Same type, different message (list position shape check, dist/transcripts-BzXJGPO2.mjs:70). */
export const ERR_INVALID_CURSOR_LIBRARY = libraryError('transcript_invalid_cursor', 'Invalid transcript library cursor.')
export const ERR_INVALID_CURSOR_READER = libraryError('transcript_invalid_cursor', 'Invalid transcript reader cursor.')
export const ERR_INVALID_FILTER_DATES = libraryError('transcript_invalid_filter', 'Transcript date range must end after it starts.')
export const ERR_SESSION_NOT_FOUND = libraryError('transcript_session_not_found', 'Transcript not found; refresh the library and use its full selector.')
export const ERR_RESULT_TOO_LARGE = libraryError(
  'transcript_result_too_large',
  'Transcript response exceeds the read limit; request a smaller page or use a local transcript export.',
  TRANSCRIPTS_RESULT_MAX_BYTES,
)
export const ERR_EXPORT_TOO_LARGE = libraryError(
  'transcript_export_too_large',
  'Transcript exceeds the download limit; use a local transcript export.',
  TRANSCRIPTS_EXPORT_MAX_BYTES,
)

/** dist/transcripts-BzXJGPO2.mjs:310 — no details */
export const ERR_ARCHIVE_FORBIDDEN: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'The transcript archive includes sessions hidden by your operator role; ask a Gateway administrator for archive access.',
}

/** dist/transcripts-BzXJGPO2.mjs:324 — no details */
export const ERR_ARCHIVE_UNAVAILABLE: GatewayErrorShape = {
  code: 'UNAVAILABLE',
  message: 'The transcript archive could not be read. Check Gateway diagnostics and retry.',
}

/** Schema validation failure (closed objects) dist/validation-Cn7ErDZ-.mjs:7 — no details.type */
export const ERR_INVALID_PARAMS_GET_LIMIT: GatewayErrorShape = {
  code: 'INVALID_REQUEST',
  message: 'invalid transcripts.get params: at /limit: must be <= 100',
}

/** Older gateway (2026.8 lacks status/export; 2026.6.5 lacks all) dist/server-methods-v1T0byyX.mjs:396 */
export const ERR_UNKNOWN_METHOD_STATUS: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'unknown method: transcripts.status' }
export const ERR_UNKNOWN_METHOD_EXPORT: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'unknown method: transcripts.export' }
export const ERR_UNKNOWN_METHOD_LIST: GatewayErrorShape = { code: 'INVALID_REQUEST', message: 'unknown method: transcripts.list' }

/** Missing scope dist/server-methods-v1T0byyX.mjs:198 → missingScopeErrorShape dist/error-codes-C3Z5XSDw.mjs:82 */
export const ERR_MISSING_SCOPE_READ: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'missing scope: operator.read',
  details: { code: 'MISSING_SCOPE', missingScope: 'operator.read', requiredScopes: ['operator.read'] },
}
export const ERR_MISSING_SCOPE_ADMIN_CONFIG_PATCH: GatewayErrorShape = {
  code: 'FORBIDDEN',
  message: 'missing scope: operator.admin',
  details: { code: 'MISSING_SCOPE', missingScope: 'operator.admin', requiredScopes: ['operator.admin'] },
}

/** Full frames for tests that go through gatewayClient's pending map. */
export const FRAME_EXPORT_TOO_LARGE: GatewayResFrame<never> = { type: 'res', id: 'r-41', ok: false, error: ERR_EXPORT_TOO_LARGE }
export const FRAME_LIST_OK: GatewayResFrame<TranscriptsListResult> = { type: 'res', id: 'r-40', ok: true, payload: LIST_RESULT_PAGE1 }

// ─── Config (config.get view + config.patch bodies) ─────────────────────────

/** config.get parsed view, transcripts block absent ⇒ enabled (dist/config-qnAcplqt.mjs:26 `enabled !== false`). */
export const CONFIG_TRANSCRIPTS_ABSENT: TranscriptsConfigBlock | undefined = undefined
export const CONFIG_TRANSCRIPTS_OFF: TranscriptsConfigBlock = { enabled: false }

export const CONFIG_TRANSCRIPTS_WITH_AUTOSTART: TranscriptsConfigBlock = {
  enabled: true,
  autoStart: [
    { providerId: 'discord-voice', accountId: 'work', guildId: '1234567890', channelId: '2345678901', whenOccupied: true, title: 'Standup voice' },
  ],
}

/** Body of config.patch `raw` (RFC 7396 merge patch, JSON string) — app helper sends { raw, baseHash, replacePaths? }. */
export const PATCH_CAPTURE_ON = { transcripts: { enabled: true } }

/** Adding a second, distinct guild (valid). */
export const PATCH_AUTOSTART_APPEND = {
  transcripts: {
    autoStart: [
      ...(CONFIG_TRANSCRIPTS_WITH_AUTOSTART.autoStart ?? []),
      { providerId: 'discord-voice', accountId: 'work', guildId: '99887766', channelId: '55443322', whenOccupied: true },
    ],
  },
}

/** Duplicate whenOccupied for the same account+guild — gateway skips it at runtime (dist/auto-start-BuGStKGP.mjs:300); client must reject first. */
export const AUTOSTART_DUPLICATE_GUILD_ENTRY: TranscriptsAutoStartEntry = {
  providerId: 'discord-voice',
  accountId: 'work',
  guildId: '1234567890',
  channelId: '3456789012',
  whenOccupied: true,
}

/** Removal shrinks the array ⇒ replacePaths required. */
export const PATCH_AUTOSTART_REMOVE = { raw: JSON.stringify({ transcripts: { autoStart: [] } }), replacePaths: ['transcripts.autoStart'] }

/** Empty-string title is invalid (zod string().min(1)); omit the key instead. */
export const AUTOSTART_INVALID_EMPTY_TITLE = { providerId: 'discord-voice', guildId: '1', channelId: '2', title: '' }

// ─── plugins.list (checklist rows) ──────────────────────────────────────────

/** Installed + enabled Google Meet (npm-only package). */
export const PLUGIN_GOOGLE_MEET_ENABLED: PluginCatalogEntryLite = {
  id: 'google-meet',
  name: 'Google Meet',
  packageName: '@openclaw/google-meet',
  version: '2026.9.4',
  origin: 'global',
  installed: true,
  enabled: true,
  state: 'enabled',
  removable: true,
}

export const PLUGIN_ZOOM_DISABLED: PluginCatalogEntryLite = {
  id: 'zoom-meetings',
  name: 'Zoom meetings',
  packageName: '@openclaw/zoom-meetings',
  version: '2026.9.4',
  origin: 'global',
  installed: true,
  enabled: false,
  state: 'disabled',
  removable: true,
}

export const PLUGIN_TEAMS_ERROR: PluginCatalogEntryLite = {
  id: 'teams-meetings',
  name: 'Microsoft Teams meetings',
  packageName: '@openclaw/teams-meetings',
  version: '2026.9.4',
  origin: 'global',
  installed: true,
  enabled: true,
  state: 'error',
  error: 'plugin register() threw: chrome profile not found',
  removable: true,
}

/** Not installed but listed (only happens when the hosted catalog marks it featured/ordered). */
export const PLUGIN_TEAMS_NOT_INSTALLED_LISTED: PluginCatalogEntryLite = {
  id: 'teams-meetings',
  name: 'Microsoft Teams meetings',
  packageName: '@openclaw/teams-meetings',
  origin: 'official',
  installed: false,
  enabled: false,
  state: 'not-installed',
  install: { source: 'official', pluginId: 'teams-meetings' },
}

/**
 * Typical case: none of the meeting plugins appear at all. Uninstalled official entries are only
 * listed when catalog metadata (featured/order) exists (dist/management-service-a9oXcryo.mjs:791-796);
 * the bundled entries for google-meet/teams-meetings/zoom-meetings carry none
 * (dist/official-external-plugin-bundled-catalogs-rSrC65bZ.mjs:2269,2584,2645).
 */
export const PLUGINS_LIST_NO_MEETING_PLUGINS: PluginsListResultLite = {
  plugins: [
    { id: 'browser', name: 'Browser', origin: 'bundled', installed: true, enabled: true, state: 'enabled' },
    { id: 'discord', name: 'Discord', packageName: '@openclaw/discord', origin: 'global', installed: true, enabled: true, state: 'enabled', removable: true },
  ],
  diagnostics: [],
  mutationAllowed: true,
}

export const PLUGINS_LIST_MIXED: PluginsListResultLite = {
  plugins: [PLUGIN_GOOGLE_MEET_ENABLED, PLUGIN_TEAMS_ERROR, PLUGIN_ZOOM_DISABLED],
  diagnostics: [{ level: 'error', pluginId: 'teams-meetings', message: 'plugin register() threw: chrome profile not found' }],
  mutationAllowed: true,
}

export const PLUGINS_LIST_READONLY_CONFIG: PluginsListResultLite = {
  plugins: [PLUGIN_TEAMS_NOT_INSTALLED_LISTED],
  diagnostics: [],
  mutationAllowed: false,
}

/** plugins.install request (dist/sessions-rlbLHLas.mjs:478) — valid for npm-only google-meet too. */
export const INSTALL_PARAMS_GOOGLE_MEET = { source: 'official' as const, pluginId: 'google-meet' }

// ─── Meeting tool calls in chat (DOCS-BASED; plugin code is not in the gateway package) ──

/** Links for detectPlatform / normaliseMeetingUrl. `expected` = platform, `sanitized` = what the gateway stores. */
export const MEETING_LINKS: { url: string; expected: 'meet' | 'teams' | 'zoom' | null; sanitized?: string }[] = [
  { url: 'https://meet.google.com/abc-defg-hij', expected: 'meet', sanitized: 'https://meet.google.com/abc-defg-hij' },
  { url: 'meet.google.com/abc-defg-hij?authuser=1', expected: 'meet', sanitized: 'https://meet.google.com/abc-defg-hij' },
  { url: 'http://MEET.GOOGLE.COM/abc-defg-hij/', expected: 'meet', sanitized: 'http://meet.google.com/abc-defg-hij/' },
  {
    url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmQ1%40thread.v2/0?context=%7b%22Tid%22%3a%22abc%22%7d',
    expected: 'teams',
    sanitized: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZmQ1%40thread.v2/0',
  },
  { url: 'https://teams.live.com/meet/9387654321098?p=AbCdEf', expected: 'teams', sanitized: 'https://teams.live.com/meet/9387654321098' },
  { url: 'https://zoom.us/j/81234567890?pwd=AbC123xyz', expected: 'zoom', sanitized: 'https://zoom.us/j/81234567890' },
  { url: 'https://acme.zoom.us/j/81234567890?pwd=AbC123xyz#success', expected: 'zoom', sanitized: 'https://acme.zoom.us/j/81234567890' },
  { url: 'https://zoom.us/my/example-room', expected: null },
  { url: 'https://evilzoom.us/j/123', expected: null },
  { url: 'https://zoom.us.evil.com/j/123', expected: null },
  { url: 'let us meet tomorrow', expected: null },
  { url: '', expected: null },
]

/** Running join (live chat tool event). */
export const TOOLCALL_ZOOM_JOIN_RUNNING: ToolCall = {
  id: 'toolu_01ZoomJoin',
  name: 'zoom_meetings',
  args: JSON.stringify({ action: 'join', url: 'https://zoom.us/j/81234567890?pwd=AbC123xyz', mode: 'transcribe' }),
  status: 'running',
  pluginId: 'zoom-meetings',
}

/** OK join. Result shape is plugin-defined and unverified; docs show a session object with id/url. */
export const TOOLCALL_MEET_JOIN_OK: ToolCall = {
  id: 'toolu_01MeetJoin',
  name: 'google_meet',
  args: JSON.stringify({ action: 'join', url: 'https://meet.google.com/xyz-abcd-efg', mode: 'transcribe' }),
  status: 'done',
  durationMs: 18450,
  pluginId: 'google-meet',
  result: JSON.stringify({ session: { id: 'meet_c0ffee42', url: 'https://meet.google.com/xyz-abcd-efg' }, inCall: true }),
}

/** manualAction: { reason, message } per docs/plugins/google-meet.md:131 and oauth-and-artifacts.md:268. */
export const TOOLCALL_MEET_JOIN_MANUAL: ToolCall = {
  id: 'toolu_01MeetLobby',
  name: 'google_meet',
  args: JSON.stringify({ action: 'join', url: 'https://meet.google.com/abc-defg-hij', mode: 'transcribe' }),
  status: 'done',
  durationMs: 21003,
  pluginId: 'google-meet',
  result: JSON.stringify({
    source: 'browser',
    inCall: false,
    manualAction: { reason: 'meet-admission-required', message: 'Waiting for the host to admit "OpenClaw Agent" from the lobby.' },
    browser: { nodeId: 'ba0f4e4bc1', targetId: 'tab-1', browserUrl: 'https://meet.google.com/abc-defg-hij' },
  }),
}

/** Tool error (status 'error'). */
export const TOOLCALL_TEAMS_JOIN_ERROR: ToolCall = {
  id: 'toolu_01TeamsErr',
  name: 'teams_meetings',
  args: JSON.stringify({ action: 'join', url: 'https://teams.live.com/meet/9387654321098', mode: 'transcribe' }),
  status: 'error',
  pluginId: 'teams-meetings',
  error: 'No connected Teams-capable node; install the plugin on the node or run Chrome on the Gateway host.',
}

/** Unknown/plain text result → parse as ok with raw text. */
export const TOOLCALL_ZOOM_JOIN_PLAINTEXT: ToolCall = {
  id: 'toolu_01ZoomText',
  name: 'zoom_meetings',
  args: JSON.stringify({ action: 'join', url: 'https://zoom.us/j/81234567890', mode: 'transcribe' }),
  status: 'done',
  pluginId: 'zoom-meetings',
  result: 'Joined Zoom meeting 81234567890 in transcribe mode.',
}

/** Sentinel the join prompt asks for when the tool is absent (assistant text, no tool call). */
export const ASSISTANT_TEXT_TOOL_MISSING = 'MEETING_TOOL_MISSING'

/** transcripts tool summarize result text (dist/openclaw-tools-Bo9W_tg_.mjs:3205). */
export const TRANSCRIPTS_TOOL_SUMMARIZE_TEXT = 'Transcripts summarized: board-prep\nSummary: /home/op/.openclaw/state/transcripts/2026-09-16/board-prep/summary.md'
/** Non-owning agent: selection fails as not-found (dist/openclaw-tools-Bo9W_tg_.mjs:2926,2977). */
export const TRANSCRIPTS_TOOL_NOT_OWNER_ERROR = 'transcripts session not found: 2026-09-11/zoom_81234567890_1789125600'
/** Tool refuses when capture is off (dist/openclaw-tools-Bo9W_tg_.mjs:3293). */
export const TRANSCRIPTS_TOOL_DISABLED_ERROR = 'transcripts are disabled'

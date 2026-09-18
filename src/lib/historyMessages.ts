import type { ChatMessage, ToolCall } from './types'
import { nanoid } from './nanoid'

// Tool calls in the gateway's chat history, and in the final frame of a run.
//
// chat.history (and a session.message event) carries an assistant's tool calls as content
// blocks `{ type: "toolCall", id, name, arguments }`. Each call's outcome is a SEPARATE
// message: `{ role: "toolResult", toolCallId, toolName, content: [blocks], isError }`.
//
// The loader only recognised Anthropic's wire spelling (`tool_use` + `input`) and dropped
// result rows. So every tool call vanished when a chat was reopened, taking diffs,
// question cards, script cards and sub-agent tool lists with it, while the live view
// (built from agent events) showed them fine. Both spellings are read here, and results
// are attached to their calls, so a reloaded call looks the way the live one did.

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

// The gateway's own content helper accepts every spelling a provider or an older
// transcript uses (chat-display-projection: isToolCallContentType, TOOL_USE_ID_FIELDS),
// so the app does too.
const TOOL_CALL_TYPES = new Set(['toolcall', 'tool_call', 'tooluse', 'tool_use'])
const TOOL_RESULT_ROLES = new Set(['toolresult', 'tool_result', 'tool', 'function'])
const ID_FIELDS = ['id', 'toolCallId', 'tool_call_id', 'toolUseId', 'tool_use_id'] as const
const RESULT_ID_FIELDS = ['toolCallId', 'tool_call_id', 'toolUseId', 'tool_use_id'] as const

const firstString = (r: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  for (const k of keys) { const v = r[k]; if (typeof v === 'string' && v) return v }
  return undefined
}

/** The tool calls in one message's content blocks. Status is 'done' until a result says otherwise. */
export function extractToolCalls(msg: unknown, pluginIdFor?: (toolName: string) => string | undefined): ToolCall[] {
  const content = rec(msg)?.content
  if (!Array.isArray(content)) return []
  const out: ToolCall[] = []
  for (const raw of content) {
    const b = rec(raw)
    if (!b || typeof b.type !== 'string' || !TOOL_CALL_TYPES.has(b.type.toLowerCase())) continue
    const args = b.arguments !== undefined ? b.arguments : b.input
    const name = typeof b.name === 'string' && b.name ? b.name : 'unknown'
    const pluginId = pluginIdFor?.(name)
    out.push({
      id: firstString(b, ID_FIELDS) ?? nanoid(),
      name,
      ...(args !== undefined ? { args: typeof args === 'string' ? args : JSON.stringify(args) } : {}),
      status: 'done',
      ...(pluginId ? { pluginId } : {}),
    })
  }
  return out
}

export interface ToolResultUpdate {
  callId: string
  patch: Pick<ToolCall, 'status'> & Partial<Pick<ToolCall, 'result' | 'error'>>
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(b => { const r = rec(b); return r && r.type === 'text' && typeof r.text === 'string' ? r.text : '' })
    .filter(Boolean)
    .join('\n')
}

/**
 * A `toolResult` message, as an update to the call it answers. Null for any other message.
 * Produces the same patch the live path makes from an agent `result` event.
 */
export function toolResultUpdate(msg: unknown): ToolResultUpdate | null {
  const m = rec(msg)
  if (!m || typeof m.role !== 'string' || !TOOL_RESULT_ROLES.has(m.role.toLowerCase())) return null
  const callId = firstString(m, RESULT_ID_FIELDS)
  if (!callId) return null
  const text = resultText(m.content)
  return m.isError === true || m.is_error === true
    ? { callId, patch: { status: 'error', error: text || 'Tool returned an error' } }
    : { callId, patch: { status: 'done', ...(text ? { result: text } : {}) } }
}

/**
 * Whether a message is a tool result row, in any spelling, with or without a call id.
 * The gateway's oversized placeholder keeps the role but loses the id, so it can't be paired.
 */
export function isToolResultRole(msg: unknown): boolean {
  const role = rec(msg)?.role
  return typeof role === 'string' && TOOL_RESULT_ROLES.has(role.toLowerCase())
}

export const NESTED_TOOL_ACTIVITY = 'openclaw.nested-tool.v1'

/**
 * Nested tool activity (a sub-agent's calls under the parent's yield) arrives as its own
 * `role: "custom"` row holding a `toolCall` block and a `toolResult` block. Rewritten
 * into the ordinary shape: the call joins the assistant message before it, and the
 * result becomes a result row after, so the rest of the mapping treats it like any call.
 * Everything else passes through untouched.
 */
export function foldNestedToolRows(raw: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const item of raw) {
    const m = rec(item)
    if (!m || m.role !== 'custom' || m.customType !== NESTED_TOOL_ACTIVITY || !Array.isArray(m.content)) { out.push(item); continue }
    const blocks = m.content.map(rec).filter((b): b is Record<string, unknown> => !!b)
    const calls = blocks.filter(b => typeof b.type === 'string' && TOOL_CALL_TYPES.has(b.type.toLowerCase()))
    const results = blocks.filter(b => typeof b.type === 'string' && b.type.toLowerCase() === 'toolresult')
    let at = out.length - 1
    while (at >= 0 && rec(out[at])?.role !== 'assistant') at--
    const host = rec(out[at])
    if (!host || !calls.length) continue
    const hostContent = Array.isArray(host.content) ? host.content : typeof host.content === 'string' ? [{ type: 'text', text: host.content }] : []
    out[at] = { ...host, content: [...hostContent, ...calls] }
    for (const r of results) out.push({ ...r, role: 'toolResult' })
  }
  return out
}

/**
 * While a run is still going, a call in the latest turn that has no result yet is still
 * running, as the live view would show it. Anything older has simply finished.
 */
export function markRunningCalls(messages: ChatMessage[], activeRun: boolean): ChatMessage[] {
  if (!activeRun) return messages
  const lastUser = messages.map(m => m.role).lastIndexOf('user')
  return messages.map((m, i) => i <= lastUser || m.role !== 'assistant' || !m.toolCalls?.some(unanswered) ? m : {
    ...m,
    toolCalls: m.toolCalls.map(tc => (unanswered(tc) ? { ...tc, status: 'running' as const } : tc)),
  })
}

const unanswered = (tc: ToolCall) => tc.status === 'done' && tc.result === undefined && tc.error === undefined

/** Attach results to the calls they answer, wherever those calls are. Results with no matching call are ignored. */
export function applyToolResults(messages: ChatMessage[], updates: ToolResultUpdate[]): ChatMessage[] {
  if (!updates.length) return messages
  const byId = new Map(updates.map(u => [u.callId, u.patch]))
  return messages.map(m => {
    if (!m.toolCalls?.some(tc => byId.has(tc.id))) return m
    return { ...m, toolCalls: m.toolCalls.map(tc => (byId.has(tc.id) ? { ...tc, ...byId.get(tc.id)! } : tc)) }
  })
}

/**
 * The tool calls for a finished turn. The live stream built each call from agent events,
 * with its result, error and plugin, so those calls are kept exactly as they are. The
 * final message only adds calls the stream never reported (a dropped event, or a reconnect
 * mid-turn). A spawn is left out, because the live view shows it as a thread, not a call.
 * Replacing the list, as the final frame used to, would wipe every result.
 */
export function mergeFinalToolCalls(live: ToolCall[] | undefined, final: ToolCall[]): ToolCall[] | undefined {
  const known = new Set((live ?? []).map(t => t.id))
  const added = final.filter(t => !known.has(t.id) && t.name !== 'sessions_spawn')
  if (!added.length) return live
  return [...(live ?? []), ...added]
}

/** A history message's id: its own, else the gateway's transcript id in `__openclaw.id`. */
export function historyMessageId(msg: unknown): string | undefined {
  const m = rec(msg)
  if (!m) return undefined
  if (typeof m.id === 'string' && m.id) return m.id
  const meta = rec(m.__openclaw)
  return typeof meta?.id === 'string' && meta.id ? meta.id : undefined
}

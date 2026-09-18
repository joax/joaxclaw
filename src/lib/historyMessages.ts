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

/** The tool calls in one message's content blocks. Status is 'done' until a result says otherwise. */
export function extractToolCalls(msg: unknown, pluginIdFor?: (toolName: string) => string | undefined): ToolCall[] {
  const content = rec(msg)?.content
  if (!Array.isArray(content)) return []
  const out: ToolCall[] = []
  for (const raw of content) {
    const b = rec(raw)
    if (!b || (b.type !== 'toolCall' && b.type !== 'tool_use')) continue
    const args = b.type === 'toolCall' ? b.arguments : b.input
    const name = typeof b.name === 'string' && b.name ? b.name : 'unknown'
    const pluginId = pluginIdFor?.(name)
    out.push({
      id: typeof b.id === 'string' && b.id ? b.id : nanoid(),
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
  if (!m || m.role !== 'toolResult' || typeof m.toolCallId !== 'string' || !m.toolCallId) return null
  const text = resultText(m.content)
  return m.isError === true
    ? { callId: m.toolCallId, patch: { status: 'error', error: text || 'Tool returned an error' } }
    : { callId: m.toolCallId, patch: { status: 'done', ...(text ? { result: text } : {}) } }
}

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

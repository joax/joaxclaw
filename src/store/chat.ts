import { create } from 'zustand'
import { nanoid } from '../lib/nanoid'
import type { Conversation, ChatMessage, ContextOverflowInfo, ToolCall, SubThread, MediaAttachment, ThinkingLevel } from '../lib/types'
import { gatewayClient } from '../lib/gateway'
import { agentIdFromSessionKey as agentIdFromKey } from '../lib/sessionName'
import { useExtensionsStore } from './extensions'
import { useConnectionStore } from './connection'

const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|aac|opus|webm|flac)(\?[^\s]*)?$/i
const AUDIO_MIME = /^audio\//i
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

// Tracks active stream handlers per convId so they can be cancelled
const activeStreams = new Map<string, { unsub: () => void; sessionKey: string }>()

interface ChatEventPayload {
  sessionKey?: string
  state?: string
  deltaText?: string
  replace?: boolean
  message?: unknown
  errorMessage?: string
  waitingSessionKey?: string
  subSessionKey?: string
}

interface AgentEventPayload {
  sessionKey?: string
  stream?: string
  runId?: string
  seq?: number
  ts?: number
  data?: {
    phase?: string
    name?: string
    toolCallId?: string
    args?: unknown
    result?: unknown
    isError?: boolean
    text?: string
    delta?: string
    partialResult?: unknown
  }
}

type UpdateFn = (updater: (msg: ChatMessage) => ChatMessage) => void

// ── Sub-agent threads ───────────────────────────────────────────────────────────


function parseResult(result: unknown): Record<string, unknown> {
  if (typeof result === 'string') { try { return JSON.parse(result) as Record<string, unknown> } catch { return {} } }
  return (result ?? {}) as Record<string, unknown>
}

function threadPreview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine
}

// Immutably upsert a SubThread by id, applying a patch (object or updater).
function patchThread(
  threads: SubThread[] | undefined,
  id: string,
  patch: Partial<SubThread> | ((t: SubThread) => Partial<SubThread>),
): SubThread[] {
  const list = threads ? [...threads] : []
  const idx = list.findIndex(t => t.id === id)
  if (idx === -1) {
    const base: SubThread = { id, status: 'running', content: '', startedAt: new Date().toISOString() }
    list.push({ ...base, ...(typeof patch === 'function' ? patch(base) : patch) })
  } else {
    list[idx] = { ...list[idx], ...(typeof patch === 'function' ? patch(list[idx]) : patch) }
  }
  return list
}

// When the parent turn ends, settle any thread still shown as in-flight so its chip
// stops spinning (the stream listener is about to detach).
function finalizeThreads(update: UpdateFn): void {
  update(m => {
    if (!m.threads?.length) return m
    const threads = m.threads.map(t =>
      t.status === 'spawning' || t.status === 'running'
        ? { ...t, status: 'done' as const, finishedAt: t.finishedAt ?? new Date().toISOString(), resultPreview: t.resultPreview ?? threadPreview(t.content) }
        : t)
    return { ...m, threads }
  })
}

// Route one frame from a spawned sub-agent into its SubThread on the parent message.
function applyChildFrame(event: string, p: ChatEventPayload & AgentEventPayload, threadId: string, update: UpdateFn): void {
  const set = (patch: Partial<SubThread> | ((t: SubThread) => Partial<SubThread>)) =>
    update(m => ({ ...m, threads: patchThread(m.threads, threadId, patch) }))

  if (event === 'agent') {
    const d = p.data
    if (p.stream === 'thinking' && d?.delta) {
      set(t => ({ reasoning: (t.reasoning ?? '') + d.delta }))
    } else if (p.stream === 'tool' || p.stream === 'item') {
      // Workers surface tool activity as stream:'tool' (phase start/result) or
      // stream:'item' (phase start/end). Map both into the thread's tool list.
      const name = d?.name ?? 'tool'
      const id = d?.toolCallId ?? `${name}:${p.seq ?? ''}`
      if (d?.phase === 'start') {
        set(t => ({ status: 'running', toolCalls: [...(t.toolCalls ?? []), { id, name, status: 'running', args: d?.args !== undefined ? JSON.stringify(d.args) : undefined }] }))
      } else if (d?.phase === 'result' || d?.phase === 'end') {
        const resultStr = d?.result !== undefined ? (typeof d.result === 'string' ? d.result : JSON.stringify(d.result)) : undefined
        set(t => {
          const calls = t.toolCalls ?? []
          // Match by id, else the most recent running call of the same name.
          let target = calls.findIndex(tc => tc.id === id)
          if (target === -1) target = calls.map(tc => tc.name).lastIndexOf(name)
          if (target === -1) return {}
          const next = [...calls]
          next[target] = { ...next[target], status: d?.isError ? 'error' : 'done', result: d?.isError ? undefined : resultStr, error: d?.isError ? (resultStr ?? 'error') : undefined }
          return { toolCalls: next }
        })
      }
    }
    return
  }

  // chat events
  switch (p.state) {
    case 'delta':
      if (p.replace) set({ content: p.deltaText ?? '', status: 'running' })
      else if (p.deltaText) set(t => ({ content: t.content + p.deltaText, status: 'running' }))
      break
    case 'thinking_delta':
      if (p.deltaText) set(t => ({ reasoning: (t.reasoning ?? '') + p.deltaText }))
      break
    case 'final': {
      const finalText = extractText(p.message)
      set(t => {
        const content = t.content || finalText || ''
        return { status: 'done', finishedAt: new Date().toISOString(), content, resultPreview: threadPreview(content) }
      })
      break
    }
    case 'error':
    case 'incomplete':
      set({ status: 'error', finishedAt: new Date().toISOString(), error: p.errorMessage ?? extractText(p.message) ?? 'error' })
      break
    case 'aborted':
      set(t => ({ status: t.status === 'done' ? 'done' : 'error', finishedAt: new Date().toISOString(), error: t.error ?? 'aborted' }))
      break
  }
}

// Shared chat event handler — used by both sendMessage and watchSession.
// onInitConflict (send path only) is invoked when the gateway rejects the turn with a
// transient "reply session initialization conflicted" — the stream is torn down silently
// and the caller decides whether to re-send, instead of surfacing a dead ⚠ turn.
function attachChatStream(
  convId: string,
  sessionKey: string,
  update: UpdateFn,
  opts?: { onInitConflict?: () => void },
): void {
  // Sub-agent thread routing for this stream. childKeys: a spawned child's session key
  // → its threadId. spawnCalls: a sessions_spawn toolCallId → threadId (the child's
  // session key only arrives later, on the spawn tool's result).
  const childKeys = new Map<string, string>()
  const spawnCalls = new Map<string, string>()

  const unsub = gatewayClient.on((frame) => {
    if (frame.event !== 'chat' && frame.event !== 'agent' && frame.event !== 'context-overflow-diag') return
    const p = frame.payload as ChatEventPayload & AgentEventPayload & {
      provider?: string; messages?: number; compactionTokens?: number
      observedTokens?: number | string; error?: string; diagId?: string; spawnedBy?: string
    }

    // Frames from a spawned sub-agent (different session key) are routed into a thread
    // on the live message instead of being dropped. A direct child carries
    // spawnedBy === our session key; once seen, its key is remembered.
    if (p.sessionKey !== sessionKey) {
      let threadId = p.sessionKey ? childKeys.get(p.sessionKey) : undefined
      if (!threadId && p.sessionKey && p.spawnedBy === sessionKey) {
        threadId = p.sessionKey
        childKeys.set(p.sessionKey, threadId)
        const agentId = agentIdFromKey(p.sessionKey)
        update(m => ({ ...m, threads: patchThread(m.threads, threadId!, { id: threadId!, childSessionKey: p.sessionKey, agentId, status: 'running' }) }))
      }
      if (threadId && (frame.event === 'chat' || frame.event === 'agent')) applyChildFrame(frame.event, p, threadId, update)
      return
    }

    if (frame.event === 'context-overflow-diag') {
      const overflow: ContextOverflowInfo = {
        provider: p.provider,
        messages: p.messages,
        compactionTokens: p.compactionTokens,
        observedTokens: p.observedTokens,
        error: p.error ?? 'Context overflow',
        diagId: p.diagId
      }
      update(m => ({ ...m, contextOverflow: overflow }))
      return
    }

    if (frame.event === 'agent') {
      // Runtime error surfaced through the agent event (e.g. incomplete turn, embedded agent crash)
      if (p.stream === 'error' || (p as Record<string, unknown>).state === 'error') {
        const raw = p as Record<string, unknown>
        const errText = (raw.errorMessage as string | undefined)
          ?? (raw.message as string | undefined)
          ?? 'Agent runtime error'
        // Transient gateway race: two initializations of the same session's reply
        // context collided. The turn never started, so tear the stream down silently
        // and let the send path re-fire — don't leave a dead ⚠ bubble.
        if (opts?.onInitConflict && /initialization conflicted/i.test(errText)) {
          activeStreams.delete(convId)
          unsub()
          opts.onInitConflict()
          return
        }
        update(m => ({
          ...m,
          content: m.content ? `${m.content}\n\n⚠ ${errText}` : `⚠ ${errText}`,
          streaming: false,
          reasoningStreaming: false,
          waitingForSession: undefined,
        }))
        finalizeThreads(update)
        activeStreams.delete(convId)
        unsub()
        return
      }
      // Thinking stream: real-time reasoning text
      if (p.stream === 'thinking' && p.data?.delta) {
        update(m => ({ ...m, reasoning: (m.reasoning ?? '') + p.data!.delta!, reasoningStreaming: true, reasoningStartedAt: m.reasoningStartedAt ?? Date.now(), waitingForSession: undefined }))
      // Tool stream: tool call lifecycle events
      } else if (p.stream === 'tool') {
        if (p.data?.phase === 'start') {
          const toolName = p.data.name ?? 'unknown'
          // A sessions_spawn is shown as an inline thread, not a raw tool card.
          if (toolName === 'sessions_spawn') {
            const tid = p.data.toolCallId ?? nanoid()
            spawnCalls.set(tid, tid)
            const a = (p.data.args ?? {}) as Record<string, unknown>
            const agentId = String(a.agentId ?? a.agent ?? a.taskName ?? '')
            const task = String(a.task ?? a.prompt ?? a.message ?? '')
            update(m => ({ ...m, threads: patchThread(m.threads, tid, {
              id: tid, status: 'spawning',
              ...(agentId ? { agentId } : {}), ...(task ? { task } : {}),
              startedAt: new Date().toISOString(),
            }), waitingForSession: undefined }))
            return
          }
          const pluginId = useExtensionsStore.getState().toolNameMap.get(toolName)
          const newCall: ToolCall = {
            id: p.data.toolCallId ?? nanoid(),
            name: toolName,
            args: p.data.args !== undefined ? JSON.stringify(p.data.args) : undefined,
            status: 'running',
            ...(pluginId ? { pluginId } : {})
          }
          update(m => ({ ...m, toolCalls: [...(m.toolCalls ?? []), newCall], waitingForSession: undefined }))
        } else if (p.data?.phase === 'result') {
          const callId = p.data.toolCallId
          // A sessions_spawn result carries the new child session key — link it to the thread.
          if (callId && spawnCalls.has(callId)) {
            const tid = spawnCalls.get(callId)!
            const r = parseResult(p.data.result)
            const childKey = String(r.childSessionKey ?? r.sessionKey ?? r.key ?? '')
            if (childKey) childKeys.set(childKey, tid)
            update(m => ({ ...m, threads: patchThread(m.threads, tid, t => ({
              status: t.status === 'done' || t.status === 'error' ? t.status : 'running',
              ...(childKey ? { childSessionKey: childKey, ...(t.agentId ? {} : { agentId: agentIdFromKey(childKey) }) } : {}),
            })) }))
            return
          }
          const rawResult = p.data!.result
          const resultStr = rawResult !== undefined
            ? (typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2))
            : undefined
          update(m => ({
            ...m,
            toolCalls: (m.toolCalls ?? []).map(tc =>
              tc.id !== callId ? tc : {
                ...tc,
                status: p.data!.isError ? 'error' : 'done',
                result: p.data!.isError ? undefined : resultStr,
                error: p.data!.isError ? (resultStr ?? 'Tool returned an error') : undefined
              }
            )
          }))
        }
      }
      return
    }

    // chat events
    if (p.state === 'delta') {
      // First answer token ends the "thinking" phase — freeze the reasoning duration.
      const stamp = (m: ChatMessage) => m.reasoningStartedAt && !m.reasoningDurationMs ? { reasoningDurationMs: Date.now() - m.reasoningStartedAt } : {}
      if (p.replace) {
        update(m => ({ ...m, content: p.deltaText ?? '', waitingForSession: undefined, ...stamp(m) }))
      } else if (p.deltaText) {
        update(m => ({ ...m, content: m.content + p.deltaText, waitingForSession: undefined, ...stamp(m) }))
      }
    } else if (p.state === 'thinking_delta') {
      if (p.deltaText) {
        update(m => ({ ...m, reasoning: (m.reasoning ?? '') + p.deltaText, reasoningStreaming: true, reasoningStartedAt: m.reasoningStartedAt ?? Date.now(), waitingForSession: undefined }))
      }
    } else if (p.state === 'waiting' || p.state === 'delegating' || p.state === 'blocked' || p.state === 'waiting_for_session') {
      const subKey = p.waitingSessionKey ?? p.subSessionKey
      update(m => ({ ...m, waitingForSession: subKey ?? 'unknown' }))
    } else if (p.state === 'final') {
      const finalText = extractText(p.message)
      const finalReasoning = extractReasoning(p.message)
      const finalToolCalls = extractToolCalls(p.message)
      const finalAttachments = extractAttachments(p.message)
      const finalModel = extractModel(p.message) ?? (p as Record<string, unknown>).model as string | undefined
      // This gateway ends the agent's run with an EMPTY `final` at a sessions_yield (the
      // pause to wait for a spawned sub-agent), then AUTO-RESUMES the agent and emits the
      // real answer in a later, non-empty `final`. Treat an empty final while a sub-agent
      // is still in flight as that yield boundary — stay subscribed so the resumed answer
      // streams in, instead of finalizing the turn here (which made it look "stopped").
      let yieldedWaitingForSubAgent = false
      update(m => {
        if (!finalText && (m.threads ?? []).some(t => t.status === 'running' || t.status === 'spawning')) {
          yieldedWaitingForSubAgent = true
          return { ...m, waitingForSession: undefined }
        }
        return {
          ...m,
          ...(finalText ? { content: finalText } : {}),
          ...(finalReasoning ? { reasoning: finalReasoning } : {}),
          // Freeze reasoning duration if the answer arrived only at final (no streamed deltas).
          ...((finalReasoning || m.reasoning) && m.reasoningStartedAt && !m.reasoningDurationMs ? { reasoningDurationMs: Date.now() - m.reasoningStartedAt } : {}),
          ...(finalToolCalls.length ? { toolCalls: finalToolCalls } : {}),
          ...(finalAttachments.length ? { attachments: finalAttachments } : {}),
          ...(finalModel ? { model: finalModel } : {}),
          streaming: false,
          reasoningStreaming: false,
          waitingForSession: undefined
        }
      })
      if (yieldedWaitingForSubAgent) return  // keep the stream open for the auto-resume
      finalizeThreads(update)
      activeStreams.delete(convId)
      unsub()
    } else if (p.state === 'error' || p.state === 'incomplete') {
      // Resolve error text from errorMessage, or fall back to p.message text (gateway may use either)
      const errText = (p.errorMessage ?? extractText(p.message))
        || (p.state === 'incomplete' ? 'Incomplete turn — the agent stopped without producing a response' : 'Unknown error')
      update(m => ({
        ...m,
        // Always surface the error. If there was partial content, append so nothing is lost.
        content: m.content ? `${m.content}\n\n⚠ ${errText}` : `⚠ ${errText}`,
        streaming: false,
        reasoningStreaming: false,
        waitingForSession: undefined,
      }))
      finalizeThreads(update)
      activeStreams.delete(convId)
      unsub()
    } else if (p.state === 'aborted') {
      const abortMsg = p.errorMessage
      update(m => ({
        ...m,
        streaming: false,
        reasoningStreaming: false,
        ...(abortMsg && !m.content ? { content: `Aborted: ${abortMsg}` } : {})
      }))
      finalizeThreads(update)
      activeStreams.delete(convId)
      unsub()
    }
  })
  activeStreams.set(convId, { unsub, sessionKey })
}

interface ChatState {
  conversations: Conversation[]
  activeConvId: string | null

  newConversation: (agentId: string, agentName: string, sessionKey?: string) => string
  selectConversation: (id: string) => void
  setModelOverride: (convId: string, model: string | null) => Promise<void>
  setThinkingLevel: (convId: string, level: ThinkingLevel) => void
  sendMessage: (convId: string, text: string, attachments?: MediaAttachment[]) => Promise<void>
  abortStream: (convId: string) => Promise<void>
  compact: (convId: string) => Promise<void>
  watchSession: (convId: string, sessionKey: string) => void
  deleteConversation: (id: string) => void
  loadSessionMessages: (sessionKey: string, agentId: string, agentName: string) => Promise<string>
}

function makeTitle(text: string): string {
  return text.length > 40 ? text.slice(0, 40) + '…' : text
}

function sessionTitle(sessionKey: string, agentName: string): string {
  // Prefer a real display name when the caller has one; otherwise fall back to the
  // agent id parsed from the key (e.g. "research-worker") rather than an opaque
  // "subagent · <uuid>" rendering.
  if (agentName && agentName !== sessionKey) return agentName
  return agentIdFromKey(sessionKey)
}

function extractModel(msg: unknown): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const m = msg as Record<string, unknown>
  if (typeof m.model === 'string' && m.model) return m.model
  return undefined
}

function extractText(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return ''
  const m = msg as Record<string, unknown>
  if (typeof m.text === 'string' && m.text) return m.text as string
  if (Array.isArray(m.content)) {
    return (m.content as Record<string, unknown>[])
      .filter(b => b && typeof b === 'object' && b['type'] === 'text' && typeof b['text'] === 'string')
      .map(b => b['text'] as string)
      .join('\n')
  }
  if (typeof m.content === 'string') return m.content as string
  return ''
}

function extractReasoning(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return ''
  const m = msg as Record<string, unknown>
  if (Array.isArray(m.content)) {
    const blocks = m.content as Record<string, unknown>[]
    return blocks
      .filter(b => b && typeof b === 'object' && b['type'] === 'thinking' && typeof b['thinking'] === 'string')
      .map(b => b['thinking'] as string)
      .join('\n')
  }
  return ''
}

function extractAttachments(msg: unknown): MediaAttachment[] {
  if (!msg || typeof msg !== 'object') return []
  const m = msg as Record<string, unknown>
  const result: MediaAttachment[] = []

  if (Array.isArray(m.content)) {
    for (const b of m.content as Record<string, unknown>[]) {
      if (!b || typeof b !== 'object') continue
      const btype = b['type'] as string | undefined
      const mediaType = (b['mediaType'] ?? b['mimeType']) as string | undefined

      const isAudioBlock =
        btype === 'audio' ||
        (btype === 'file' && mediaType && AUDIO_MIME.test(mediaType))

      if (isAudioBlock) {
        const src = b['source'] as Record<string, unknown> | undefined
        result.push({
          type: 'audio',
          url: (b['url'] ?? src?.['url']) as string | undefined,
          data: (b['data'] ?? src?.['data']) as string | undefined,
          mediaType: mediaType ?? (src?.['mediaType'] as string | undefined),
          name: b['name'] as string | undefined
        })
      }
    }
  }

  // User messages from WhatsApp/channels store media as MediaPath/MediaPaths top-level fields
  const mediaPaths = Array.isArray(m['MediaPaths'])
    ? m['MediaPaths'] as string[]
    : typeof m['MediaPath'] === 'string' ? [m['MediaPath'] as string] : []
  const mediaTypes = Array.isArray(m['MediaTypes'])
    ? m['MediaTypes'] as string[]
    : typeof m['MediaType'] === 'string' ? [m['MediaType'] as string] : []
  for (let i = 0; i < mediaPaths.length; i++) {
    const p = mediaPaths[i]
    const mt = mediaTypes[i] ?? ''
    if (typeof p === 'string' && p && AUDIO_MIME.test(mt)) {
      result.push({ type: 'audio', url: `file://${p}`, mediaType: mt || undefined })
    }
  }

  // Scan text for bare audio URLs
  const text = typeof m.text === 'string' ? m.text
    : typeof m.content === 'string' ? m.content
    : extractText(msg)
  let match: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((match = URL_RE.exec(text)) !== null) {
    if (AUDIO_EXT.test(match[0])) {
      result.push({ type: 'audio', url: match[0] })
    }
  }

  return result
}

function extractToolCalls(msg: unknown): ToolCall[] {
  if (!msg || typeof msg !== 'object') return []
  const m = msg as Record<string, unknown>
  if (!Array.isArray(m.content)) return []
  const blocks = m.content as Record<string, unknown>[]
  return blocks
    .filter(b => b && typeof b === 'object' && b['type'] === 'tool_use')
    .map(b => ({
      id: String(b['id'] ?? nanoid()),
      name: String(b['name'] ?? 'unknown'),
      args: b['input'] !== undefined ? JSON.stringify(b['input']) : undefined,
      status: 'done' as const
    }))
}

// On reload, the sub-agent "threads" (session yields) are NOT in the parent's
// chat.history — each sub-agent ran in its own child session, and the threads were built
// live from spawnedBy-routed events. Rebuild them by finding the children this session
// spawned (sessions.list carries spawnedBy / parentSessionKey) and loading each child's
// history. Fully guarded: any failure just yields no threads, never breaking the reload.
async function reconstructSubThreads(parentKey: string): Promise<SubThread[]> {
  try {
    const list = await gatewayClient.request<{ sessions?: Record<string, unknown>[] }>('sessions.list', {})
    const children = (list.sessions ?? []).filter(r =>
      !!r && (r['spawnedBy'] === parentKey || r['parentSessionKey'] === parentKey))
    if (!children.length) return []

    const TERMINAL = new Set(['idle', 'done', 'failed', 'killed', 'timeout'])
    const built = await Promise.all(children.map(async (r): Promise<SubThread | null> => {
      const key = String(r['key'] ?? '')
      if (!key) return null
      // A yield can still be pending/running at reconnect — mark it so instead of freezing
      // it as done. Live frames (routed by spawnedBy) then patch the same thread by id.
      const st = r['status']
      const running = r['hasActiveRun'] === true || (typeof st === 'string' && !TERMINAL.has(st) && st !== '')
      try {
        const h = await gatewayClient.request<{ messages: unknown[] }>('chat.history', { sessionKey: key })
        const msgs = (h.messages ?? []).filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        const asst = msgs.filter(m => m['role'] === 'assistant')
        const content = asst.map(extractText).filter(Boolean).join('\n\n')
        const reasoning = asst.map(extractReasoning).filter(Boolean).join('\n') || undefined
        const toolCalls = asst.flatMap(extractToolCalls).filter(tc => tc.name !== 'sessions_spawn')
        // Drop only truly-empty finished children; keep running ones so pending yields show.
        if (!running && !content && !reasoning && !toolCalls.length) return null
        // The sub-agent's brief = its first user message; makes a far better label than the
        // generic worker agent id (which is the same for every leaf).
        const firstUser = msgs.find(m => m['role'] === 'user')
        const brief = (firstUser ? extractText(firstUser) : '').trim()
        return {
          id: key,
          childSessionKey: key,
          agentId: (typeof r['subagentRole'] === 'string' && r['subagentRole']) || agentIdFromKey(key),
          task: brief || (r['label'] as string) || (r['displayName'] as string) || undefined,
          status: running ? 'running' : 'done',
          content,
          reasoning,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          startedAt: typeof r['startedAt'] === 'number' ? new Date(r['startedAt'] as number).toISOString() : new Date().toISOString(),
          ...(running ? {} : { finishedAt: typeof r['updatedAt'] === 'number' ? new Date(r['updatedAt'] as number).toISOString() : undefined }),
        }
      } catch { return null }
    }))
    return built.filter((t): t is SubThread => t !== null)
  } catch {
    return []
  }
}

// Attach reconstructed COMPLETED sub-agent threads to their past assistant turn — the
// last *finished* (non-streaming) assistant message that yielded/spawned, else the last
// finished assistant message. Running yields belong to the live turn and are seeded onto
// watchSession's placeholder instead, so they never land on a stale earlier message.
// De-duped by child session key so reloads/live frames don't stack.
function attachThreads(messages: ChatMessage[], threads: SubThread[]): ChatMessage[] {
  const YIELD = new Set(['sessions_yield', 'sessions_spawn'])
  let target = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && !m.streaming && m.toolCalls?.some(t => YIELD.has(t.name))) { target = i; break }
  }
  if (target < 0) for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && !messages[i].streaming) { target = i; break }
  }
  if (target < 0) return messages
  return messages.map((m, i) => {
    if (i !== target) return m
    const existing = m.threads ?? []
    const fresh = threads.filter(t => !existing.some(e => e.childSessionKey === t.childSessionKey))
    return fresh.length ? { ...m, threads: [...existing, ...fresh] } : m
  })
}

// Running yields belong to the in-flight turn — after the last user message. Reuse a
// trailing streaming assistant turn (watchSession's placeholder) if present; otherwise
// append a fresh in-flight assistant turn to carry them (watchSession then reuses it).
function attachRunning(messages: ChatMessage[], running: SubThread[], sessionKey: string): ChatMessage[] {
  if (!running.length) return messages
  const merge = (m: ChatMessage): ChatMessage => {
    const existing = m.threads ?? []
    const fresh = running.filter(t => !existing.some(e => e.childSessionKey === t.childSessionKey))
    return fresh.length ? { ...m, threads: [...existing, ...fresh] } : m
  }
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant' && last.streaming) {
    return messages.map((m, i) => i === messages.length - 1 ? merge(m) : m)
  }
  return [...messages, merge({
    id: nanoid(), sessionId: sessionKey, role: 'assistant', content: '', reasoning: '',
    toolCalls: [], createdAt: new Date().toISOString(), streaming: true, reasoningStreaming: false,
  })]
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConvId: null,

  newConversation(agentId, agentName, sessionKey) {
    const id = nanoid()
    const conv: Conversation = {
      id,
      sessionKey: sessionKey ?? '',
      agentId,
      agentName,
      title: `New chat with ${agentName}`,
      messages: []
    }
    set(s => ({ conversations: [conv, ...s.conversations], activeConvId: id }))
    return id
  },

  selectConversation(id) {
    set({ activeConvId: id })
  },

  // Per-chat model override. Empty/null = fall back to the agent's default model.
  // Applied at sessions.create for new chats; patched live for existing sessions.
  async setModelOverride(convId, model) {
    const value = model?.trim() || undefined
    set(s => ({
      conversations: s.conversations.map(c => c.id === convId ? { ...c, modelOverride: value } : c)
    }))
    const conv = get().conversations.find(c => c.id === convId)
    if (conv?.sessionKey) {
      // null resets the session back to the agent default (gateway treats null as "clear")
      await gatewayClient.request('sessions.patch', { key: conv.sessionKey, model: value ?? null }).catch(() => {})
    }
  },

  // Per-chat thinking level. Stored locally and passed as `thinking` on each send.
  setThinkingLevel(convId, level) {
    const value = level === 'adaptive' ? undefined : level
    set(s => ({
      conversations: s.conversations.map(c => c.id === convId ? { ...c, thinkingLevel: value } : c)
    }))
  },

  deleteConversation(id) {
    set(s => ({
      conversations: s.conversations.filter(c => c.id !== id),
      activeConvId: s.activeConvId === id ? (s.conversations.find(c => c.id !== id)?.id ?? null) : s.activeConvId
    }))
  },

  watchSession(convId, sessionKey) {
    if (activeStreams.has(convId)) return

    // Reuse a trailing in-flight assistant turn if there is one (e.g. thread
    // reconstruction added it for running yields on reconnect) so the live stream and the
    // reconstructed threads share one turn. Otherwise add a fresh streaming placeholder so
    // the user sees activity even between tool calls.
    const conv = get().conversations.find(c => c.id === convId)
    const last = conv?.messages[conv.messages.length - 1]
    let msgId: string
    if (last && last.role === 'assistant' && last.streaming) {
      msgId = last.id
    } else {
      msgId = nanoid()
      const placeholder: ChatMessage = {
        id: msgId, sessionId: sessionKey, role: 'assistant', content: '', reasoning: '',
        toolCalls: [], createdAt: new Date().toISOString(), streaming: true, reasoningStreaming: false,
      }
      set(s => ({
        conversations: s.conversations.map(c => c.id !== convId ? c : { ...c, messages: [...c.messages, placeholder] }),
      }))
    }

    const update: UpdateFn = (updater) => {
      set(s => ({
        conversations: s.conversations.map(c =>
          c.id !== convId ? c : { ...c, messages: c.messages.map(m => m.id === msgId ? updater(m) : m) }
        )
      }))
    }

    attachChatStream(convId, sessionKey, update)
  },

  async abortStream(convId) {
    const entry = activeStreams.get(convId)
    if (!entry) return
    activeStreams.delete(convId)
    entry.unsub()
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : {
          ...c,
          messages: c.messages.map(m => m.streaming ? { ...m, streaming: false, reasoningStreaming: false } : m)
        }
      )
    }))
    await gatewayClient.request('sessions.abort', { key: entry.sessionKey }).catch(() => {})
  },

  async compact(convId) {
    const conv = get().conversations.find(c => c.id === convId)
    if (!conv?.sessionKey) return

    // Insert a pending system notice so the user gets immediate feedback
    const noticeId = nanoid()
    const notice: ChatMessage = {
      id: noticeId,
      sessionId: conv.sessionKey,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      streaming: true,
    }
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : { ...c, messages: [...c.messages, notice] }
      )
    }))

    const finish = (content: string) => set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : {
          ...c,
          messages: c.messages.map(m =>
            m.id === noticeId ? { ...m, content, streaming: false } : m
          )
        }
      )
    }))

    // Each entry is [method, params] — tried in order until one succeeds.
    // sessions.* methods use { key }, chat.* methods use { sessionKey }.
    const attempts: [string, Record<string, unknown>][] = [
      ['chat.compact',     { sessionKey: conv.sessionKey }],
      ['sessions.compact', { key: conv.sessionKey }],
      ['sessions.steer',   { key: conv.sessionKey, action: 'compact' }],
      ['chat.compact',     { key: conv.sessionKey }],
    ]

    let lastError = ''
    for (const [method, params] of attempts) {
      try {
        await gatewayClient.request(method, params)
        finish('✓ Context compacted.')
        return
      } catch (e) {
        lastError = String(e)
      }
    }
    finish(`⚠ Compact failed: ${lastError}`)
  },

  async sendMessage(convId, text, attachments) {
    // Close any stuck streaming message from a previous run that never received final/error/aborted
    const stuckStream = activeStreams.get(convId)
    if (stuckStream) {
      stuckStream.unsub()
      activeStreams.delete(convId)
      set(s => ({
        conversations: s.conversations.map(c =>
          c.id !== convId ? c : {
            ...c,
            messages: c.messages.map(m =>
              m.streaming ? { ...m, streaming: false, reasoningStreaming: false } : m
            )
          }
        )
      }))
    }

    const userMsg: ChatMessage = {
      id: nanoid(),
      sessionId: '',
      role: 'user',
      content: text,
      attachments: attachments?.length ? attachments : undefined,
      createdAt: new Date().toISOString()
    }

    set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : {
          ...c,
          title: c.messages.length === 0 ? makeTitle(text || 'Media') : c.title,
          lastMessage: text || (attachments?.length ? `[${attachments.length} attachment${attachments.length > 1 ? 's' : ''}]` : ''),
          lastAt: userMsg.createdAt,
          messages: [...c.messages, userMsg]
        }
      )
    }))

    const conv = get().conversations.find(c => c.id === convId)
    if (!conv) return

    const assistantMsgId = nanoid()
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      sessionId: '',
      role: 'assistant',
      content: '',
      reasoning: '',
      toolCalls: [],
      createdAt: new Date().toISOString(),
      streaming: true,
      reasoningStreaming: false
    }

    set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : { ...c, messages: [...c.messages, assistantMsg] }
      )
    }))

    const updateAssistant = (updater: (msg: ChatMessage) => ChatMessage) => {
      set(s => ({
        conversations: s.conversations.map(c =>
          c.id !== convId ? c : {
            ...c,
            messages: c.messages.map(m => m.id === assistantMsgId ? updater(m) : m)
          }
        )
      }))
    }

    try {
      let sessionKey = conv.sessionKey
      if (!sessionKey) {
        const session = await gatewayClient.request<{ key: string; sessionId?: string }>('sessions.create', {
          agentId: conv.agentId,
          ...(conv.modelOverride ? { model: conv.modelOverride } : {}),
        })
        sessionKey = session.key
        set(s => ({
          conversations: s.conversations.map(c => c.id === convId ? { ...c, sessionKey } : c)
        }))
      }

      const key = sessionKey
      // The gateway occasionally rejects the first turn on a fresh session with a transient
      // "reply session initialization conflicted" (two inits of the same reply context race).
      // The turn dies with no reply, so re-fire once after a short backoff — by then the
      // gateway has finished initializing and the retry lands cleanly.
      let initRetries = 1

      const doSend = () => {
        // Bail if the conversation moved on (deleted, or the user started another turn).
        if (get().conversations.find(c => c.id === convId)?.sessionKey !== key) return

        attachChatStream(convId, key, updateAssistant, {
          onInitConflict: () => {
            if (initRetries <= 0) {
              updateAssistant(m => m.streaming
                ? { ...m, content: m.content || '⚠ reply session initialization conflicted', streaming: false, waitingForSession: undefined }
                : m)
              return
            }
            initRetries--
            setTimeout(doSend, 600)
          },
        })

        // The turn's lifecycle is driven entirely by the event stream (final / error /
        // aborted), NOT by chat.send's reply. A slow local model can take far longer than
        // any request timeout to produce its first token, so we send WITHOUT a timeout
        // (timeoutMs=0) — otherwise the 30s default would fire, the catch below would set
        // streaming:false, and the chat would go silent (no indicator, no stop button)
        // while Ollama is still generating. Don't await it either: the UI updates live
        // from events. Only a genuine send failure surfaces here, and only if the stream
        // hasn't already moved on. A fresh idempotencyKey per attempt so a retry isn't
        // deduped as the (failed) original send.
        gatewayClient.request('chat.send', {
          sessionKey: key,
          message: text,
          ...(conv.thinkingLevel ? { thinking: conv.thinkingLevel } : {}),
          ...(attachments?.length ? {
            attachments: attachments.map(a => ({
              type: a.type,
              content: a.data,
              mimeType: a.mediaType,
              fileName: a.name,
            }))
          } : {}),
          idempotencyKey: nanoid(16)
        }, 0).catch(err => {
          // A late event may have already finished the turn — don't clobber it.
          updateAssistant(m => m.streaming
            ? { ...m, content: m.content || `Error: ${String(err)}`, streaming: false, waitingForSession: undefined }
            : m)
          const entry = activeStreams.get(convId)
          if (entry?.sessionKey === key) { entry.unsub(); activeStreams.delete(convId) }
        })
      }

      doSend()
    } catch (err) {
      updateAssistant(m => ({ ...m, content: `Error: ${String(err)}`, streaming: false }))
    }
  },

  async loadSessionMessages(sessionKey, agentId, agentName) {
    try {
      const history = await gatewayClient.request<{ messages: unknown[] }>('chat.history', { sessionKey })
      const messages: ChatMessage[] = (history.messages ?? [])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .filter(m => {
          const role = m['role'] as string
          return role === 'user' || role === 'assistant'
        })
        .map(m => {
          const atts = extractAttachments(m)
          return {
            id: (m['id'] as string | undefined) ?? nanoid(),
            sessionId: sessionKey,
            role: m['role'] as 'user' | 'assistant',
            content: extractText(m),
            reasoning: extractReasoning(m) || undefined,
            toolCalls: extractToolCalls(m).length ? extractToolCalls(m) : undefined,
            attachments: atts.length ? atts : undefined,
            model: extractModel(m),
            createdAt: typeof m['timestamp'] === 'number'
              ? new Date(m['timestamp']).toISOString()
              : new Date().toISOString()
          }
        })
        .filter(msg => {
          if (msg.role !== 'assistant') return true
          if (msg.toolCalls?.length || msg.attachments?.length || msg.reasoning) return true
          // Keep messages that have real thinking content inside complete <think>...</think> blocks
          const thinkContent = [...msg.content.matchAll(/<think>([\s\S]*?)<\/think>/gi)]
            .map(m => m[1].trim()).join('')
          if (thinkContent) return true
          // Drop messages whose only content is a bare unclosed <think> tag (no real text, no thinking)
          const bare = msg.content
            .replace(/<think>[\s\S]*/gi, '')
            .trim()
          return bare !== ''
        })

      const existing = get().conversations.find(c => c.sessionKey === sessionKey)
      const convId = existing?.id ?? nanoid()
      if (existing) {
        set(s => ({
          conversations: s.conversations.map(c => c.sessionKey === sessionKey ? { ...c, messages } : c),
          activeConvId: existing.id
        }))
      } else {
        const conv: Conversation = {
          id: convId, sessionKey, agentId, agentName,
          title: sessionTitle(sessionKey, agentName), messages
        }
        set(s => ({ conversations: [conv, ...s.conversations], activeConvId: convId }))
      }

      // Sub-agent yields live in child sessions, not the parent history — reattach them
      // asynchronously. Completed ones go on their finished turn; running ones on the
      // in-flight turn (after the last user message), where live frames keep patching them.
      reconstructSubThreads(sessionKey).then(threads => {
        const done = threads.filter(t => t.status !== 'running')
        const running = threads.filter(t => t.status === 'running')
        if (!done.length && !running.length) return
        set(s => ({
          conversations: s.conversations.map(c => {
            if (c.sessionKey !== sessionKey) return c
            let messages = done.length ? attachThreads(c.messages, done) : c.messages
            messages = attachRunning(messages, running, sessionKey)
            return { ...c, messages }
          })
        }))
      }).catch(() => { /* best-effort */ })

      return convId
    } catch (err) {
      console.error('Failed to load session:', err)
      return ''
    }
  }
}))

// ── Gateway-restart recovery ────────────────────────────────────────────────────
// A tool can restart the gateway (e.g. `systemctl --user restart openclaw-gateway`),
// which kills the WebSocket mid-turn. No `final` event ever arrives, so the streaming
// message would hang forever with a spinning cursor and a live Stop button. When the
// connection drops, finalize any in-flight message and flag it `interrupted` — the UI
// then shows a live "reconnecting → back online" notice (the wake-up) driven by the
// connection status, so the user knows the restart happened and can continue.
function interruptActiveStreams(): void {
  for (const [, entry] of activeStreams) entry.unsub()
  activeStreams.clear()

  const { conversations } = useChatStore.getState()
  if (!conversations.some(c => c.messages.some(m => m.streaming))) return

  useChatStore.setState({
    conversations: conversations.map(c =>
      !c.messages.some(m => m.streaming) ? c : {
        ...c,
        messages: c.messages.map(m => m.streaming ? {
          ...m,
          streaming: false,
          reasoningStreaming: false,
          waitingForSession: undefined,
          interrupted: true,
          toolCalls: m.toolCalls?.map(tc =>
            tc.status === 'running' ? { ...tc, status: 'error' as const, error: 'Interrupted — gateway connection lost' } : tc
          ),
        } : m),
      }
    ),
  })
}

// Fire when the gateway connection drops from a healthy state (restart / reload / blip).
useConnectionStore.subscribe((s, prev) => {
  if (prev.status === 'connected' && s.status !== 'connected' && s.status !== 'connecting') {
    interruptActiveStreams()
  }
})

import { create } from 'zustand'
import { nanoid } from '../lib/nanoid'
import type { Conversation, ChatMessage, ContextOverflowInfo, ToolCall, MediaAttachment } from '../lib/types'
import { gatewayClient } from '../lib/gateway'
import { useExtensionsStore } from './extensions'

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

// Shared chat event handler — used by both sendMessage and watchSession
function attachChatStream(convId: string, sessionKey: string, update: UpdateFn): void {
  const unsub = gatewayClient.on((frame) => {
    if (frame.event !== 'chat' && frame.event !== 'agent' && frame.event !== 'context-overflow-diag') return
    const p = frame.payload as ChatEventPayload & AgentEventPayload & {
      provider?: string; messages?: number; compactionTokens?: number
      observedTokens?: number | string; error?: string; diagId?: string
    }
    if (p.sessionKey !== sessionKey) return

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
      // Thinking stream: real-time reasoning text
      if (p.stream === 'thinking' && p.data?.delta) {
        update(m => ({ ...m, reasoning: (m.reasoning ?? '') + p.data!.delta!, reasoningStreaming: true, waitingForSession: undefined }))
      // Tool stream: tool call lifecycle events
      } else if (p.stream === 'tool') {
        if (p.data?.phase === 'start') {
          const toolName = p.data.name ?? 'unknown'
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
      if (p.replace) {
        update(m => ({ ...m, content: p.deltaText ?? '', waitingForSession: undefined }))
      } else if (p.deltaText) {
        update(m => ({ ...m, content: m.content + p.deltaText, waitingForSession: undefined }))
      }
    } else if (p.state === 'thinking_delta') {
      if (p.deltaText) {
        update(m => ({ ...m, reasoning: (m.reasoning ?? '') + p.deltaText, reasoningStreaming: true, waitingForSession: undefined }))
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
      update(m => ({
        ...m,
        ...(finalText ? { content: finalText } : {}),
        ...(finalReasoning ? { reasoning: finalReasoning } : {}),
        ...(finalToolCalls.length ? { toolCalls: finalToolCalls } : {}),
        ...(finalAttachments.length ? { attachments: finalAttachments } : {}),
        ...(finalModel ? { model: finalModel } : {}),
        streaming: false,
        reasoningStreaming: false,
        waitingForSession: undefined
      }))
      activeStreams.delete(convId)
      unsub()
    } else if (p.state === 'error') {
      update(m => ({ ...m, content: m.content || `Error: ${p.errorMessage ?? 'unknown'}`, streaming: false }))
      activeStreams.delete(convId)
      unsub()
    } else if (p.state === 'aborted') {
      update(m => ({
        ...m,
        streaming: false,
        ...(p.errorMessage && !m.content ? { content: `Aborted: ${p.errorMessage}` } : {})
      }))
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
  // Prefer a real display name when the caller has one
  if (agentName && agentName !== sessionKey) return agentName

  // Parse common key formats into something readable:
  // "agentId@uuid-or-id"  →  "agentId · uuid8"
  // "scope:agent:name"    →  "agent · name"
  const atIdx = sessionKey.indexOf('@')
  if (atIdx > 0) {
    const agent = sessionKey.slice(0, atIdx)
    const suffix = sessionKey.slice(atIdx + 1, atIdx + 9)
    return `${agent} · ${suffix}`
  }
  const parts = sessionKey.split(':').filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join(' · ')
  return sessionKey.slice(0, 32)
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

  deleteConversation(id) {
    set(s => ({
      conversations: s.conversations.filter(c => c.id !== id),
      activeConvId: s.activeConvId === id ? (s.conversations.find(c => c.id !== id)?.id ?? null) : s.activeConvId
    }))
  },

  watchSession(convId, sessionKey) {
    if (activeStreams.has(convId)) return

    // Lazy placeholder — only added to the conversation on the first real event
    let msgId: string | null = null

    const update: UpdateFn = (updater) => {
      if (!msgId) {
        const id = nanoid()
        msgId = id
        const placeholder: ChatMessage = {
          id,
          sessionId: sessionKey,
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
            c.id !== convId ? c : { ...c, messages: [...c.messages, placeholder] }
          )
        }))
      }
      set(s => ({
        conversations: s.conversations.map(c =>
          c.id !== convId ? c : {
            ...c,
            messages: c.messages.map(m => m.id === msgId ? updater(m) : m)
          }
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

    try {
      // Try the most likely gateway compact endpoints in order
      let ok = false
      for (const method of ['sessions.compact', 'chat.compact']) {
        try {
          await gatewayClient.request(method, { sessionKey: conv.sessionKey })
          ok = true
          break
        } catch {
          // try next
        }
      }
      if (ok) {
        finish('✓ Context compacted.')
      } else {
        finish('⚠ Compact not supported by this gateway version.')
      }
    } catch (e) {
      finish(`⚠ Compact failed: ${String(e)}`)
    }
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
        const session = await gatewayClient.request<{ key: string; sessionId?: string }>('sessions.create', { agentId: conv.agentId })
        sessionKey = session.key
        set(s => ({
          conversations: s.conversations.map(c => c.id === convId ? { ...c, sessionKey } : c)
        }))
      }

      attachChatStream(convId, sessionKey, updateAssistant)

      await gatewayClient.request('chat.send', {
        sessionKey,
        message: text,
        ...(attachments?.length ? { attachments } : {}),
        idempotencyKey: nanoid(16)
      })
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
      if (existing) {
        set(s => ({
          conversations: s.conversations.map(c => c.sessionKey === sessionKey ? { ...c, messages } : c),
          activeConvId: existing.id
        }))
        return existing.id
      }

      const convId = nanoid()
      const conv: Conversation = {
        id: convId,
        sessionKey,
        agentId,
        agentName,
        title: sessionTitle(sessionKey, agentName),
        messages
      }
      set(s => ({ conversations: [conv, ...s.conversations], activeConvId: convId }))
      return convId
    } catch (err) {
      console.error('Failed to load session:', err)
      return ''
    }
  }
}))

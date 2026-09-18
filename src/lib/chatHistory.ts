import { nanoid } from './nanoid'
import type { ChatMessage, MediaAttachment } from './types'
import { extractToolCalls, toolResultUpdate, applyToolResults, historyMessageId, foldNestedToolRows, markRunningCalls, type ToolResultUpdate } from './historyMessages'

// chat.history entries as the app's messages. Moved out of store/chat.ts unchanged, so the
// task drawer can render `tasks.history` (which returns the same objects chat.history does)
// with the same mapping. The only difference: which plugin a tool belongs to comes in as a
// parameter, because this module can't reach the extensions store.

const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|aac|opus|webm|flac)(\?[^\s]*)?$/i
const AUDIO_MIME = /^audio\//i
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

export function extractModel(msg: unknown): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const m = msg as Record<string, unknown>
  if (typeof m.model === 'string' && m.model) return m.model
  return undefined
}

export function extractText(msg: unknown): string {
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

export function extractReasoning(msg: unknown): string {
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

export function extractAttachments(msg: unknown): MediaAttachment[] {
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

// chat.history entries, and the message in a session.message event (same shape), as the
// app's messages. Tool results are attached to the calls they answer; system entries are
// dropped, and so is an assistant
// entry with nothing to show (a bare unclosed <think>).
export function toChatMessages(
  rawRows: unknown[],
  sessionKey: string,
  /** Which plugin a tool belongs to, as the live path tags it (see historyMessages.ts). */
  pluginIdFor?: (toolName: string) => string | undefined,
  /** The session still has a run going: its unanswered calls show as running. */
  activeRun = false,
): ChatMessage[] {
  // A sub-agent's nested calls come as their own rows; fold them into the ordinary shape.
  const raw = foldNestedToolRows(rawRows)
  // Results arrive as their own `toolResult` rows; they're attached to their calls below.
  const results = raw.map(toolResultUpdate).filter((u): u is ToolResultUpdate => u !== null)
  const messages = raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter(m => {
      const role = m['role'] as string
      return role === 'user' || role === 'assistant'
    })
    .map(m => {
      const atts = extractAttachments(m)
      const toolCalls = extractToolCalls(m, pluginIdFor)
      return {
        id: historyMessageId(m) ?? nanoid(),
        sessionId: sessionKey,
        role: m['role'] as 'user' | 'assistant',
        content: extractText(m),
        reasoning: extractReasoning(m) || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
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
  return markRunningCalls(applyToolResults(messages, results), activeRun)
}

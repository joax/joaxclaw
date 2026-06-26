import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, BrainCircuit, CheckCircle2, XCircle, Loader2, Clock, Hourglass, Terminal, PenLine, FileText, Search, Globe, Plug, Bot, Wrench, FolderSearch, AlertTriangle, Zap, ThumbsUp, ThumbsDown } from 'lucide-react'
import type { ChatMessage, ContextOverflowInfo, ToolCall } from '../../lib/types'
import { useExtensionsStore } from '../../store/extensions'
import { useOllamaProgress } from '../../store/ollamaProgress'
import { useSettingsStore } from '../../store/settings'
import { useConnectionStore } from '../../store/connection'
import { currentActivity, completedSteps } from '../../lib/activityLabels'
import { formatTimestamp } from '../../lib/dateUtils'
import { MarkdownContent } from './MarkdownContent'
import { AudioPlayer } from './AudioPlayer'
import { WorkspaceImage, VideoPlayer } from './WorkspaceMedia'
import { useFeedbackStore } from '../../store/feedback'

const STALE_THRESHOLD_MS = 15_000

// Extract <think>…</think> blocks that some models embed directly in content
function extractThinkTags(content: string): { thinking: string; text: string } {
  const parts: string[] = []
  let cleaned = content.replace(/<think>([\s\S]*?)<\/think>/g, (_, inner: string) => {
    parts.push(inner.trim())
    return ''
  })
  // Handle unclosed <think> tag — strip it and treat any following text as reasoning
  const openIdx = cleaned.lastIndexOf('<think>')
  if (openIdx !== -1) {
    const inner = cleaned.slice(openIdx + 7).trim()
    if (inner) parts.push(inner)
    cleaned = cleaned.slice(0, openIdx)
  }
  // Strip trailing partial <think> prefix (e.g. "<", "<t", "<th", "<thi", "<thin", "<think")
  // that arrives when a stream cuts off mid-tag
  cleaned = cleaned.replace(/<(?:t(?:h(?:i(?:n(?:k>?)?)?)?)?)?$/, '')
  return { thinking: parts.join('\n\n'), text: cleaned.trim() }
}

// Strip gateway protocol wrapper tags from content.
// Handles: <final>, </final>, variants with attributes (<final_answer>),
// and bare prefixes that arrive mid-stream without a closing > (<finalHere…).
function stripProtocolTags(text: string): string {
  return text
    .replace(/<\/final[^>]*>/gi, '')   // closing </final> or </final_answer>
    .replace(/<final[^>]*>/gi, '')     // opening <final> or <final_answer attr="">
    .replace(/^<final\S*/i, '')        // bare <final… with no > (split across stream deltas)
    .trim()
}

// ── Gateway XML action tags ───────────────────────────────────────────────────
// Models running inside Openclaw emit XML tags to invoke gateway actions.
// Two forms:
//   Self-closing:    <cron action="list" />
//   Content-bearing: <edit>path: "..." edits: ...</edit>

interface GatewayAction {
  resource: string
  action: string
  attrs: Record<string, string>
  content?: string  // present for content-bearing tags
}

// Known content-bearing gateway action tags
const CONTENT_TAGS = new Set(['edit', 'write', 'create', 'bash', 'shell', 'read', 'search', 'delete', 'move'])
const CONTENT_TAG_RE = new RegExp(`<(${[...CONTENT_TAGS].join('|')})([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'gi')
// Captures self-closing gateway action tags.
// The attribute group uses quote-aware alternation so values containing "/"
// (e.g. file paths, JSON with "/" characters) are captured correctly.
const SELFCLOSE_TAG_RE = /<([a-zA-Z][a-zA-Z0-9_-]*)((?:\s+[a-zA-Z][a-zA-Z0-9_-]*=(?:"[^"]*"|'[^']*'))*)\s*\/>/g

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Handle both quoting styles independently so single-quoted values can contain
  // double quotes (e.g. patch='{"key":"val"}') and vice versa.
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(raw)) !== null) out[m[1]] = m[2] ?? m[3]
  return out
}

function extractGatewayActions(content: string): { actions: GatewayAction[]; text: string } {
  const actions: GatewayAction[] = []

  // Content-bearing tags first
  let text = content.replace(CONTENT_TAG_RE, (_, resource, attrStr, body) => {
    const attrs = parseAttrs(attrStr ?? '')
    const action = attrs.action ?? ''
    const { action: _a, ...rest } = attrs
    actions.push({ resource: resource.toLowerCase(), action, attrs: rest, content: body.trim() })
    return ''
  })

  // Self-closing tags
  text = text.replace(SELFCLOSE_TAG_RE, (_, resource, attrStr) => {
    const attrs = parseAttrs(attrStr)
    const action = attrs.action ?? ''
    const { action: _a, ...rest } = attrs
    actions.push({ resource, action, attrs: rest })
    return ''
  })

  return { actions, text: text.trim() }
}

// ── Edit block renderer ───────────────────────────────────────────────────────

interface EditPair { oldText: string; newText: string }

function parseEditContent(raw: string): { path: string; edits: EditPair[] } | null {
  const pathMatch = raw.match(/path:\s*["']?([^\n"']+)["']?/)
  if (!pathMatch) return null
  const path = pathMatch[1].trim()

  const edits: EditPair[] = []
  // Match oldText/newText pairs (quoted values, allow HTML/special chars inside)
  const re = /oldText:\s*"([\s\S]*?)"\s*newText:\s*"([\s\S]*?)"/g
  let m
  while ((m = re.exec(raw)) !== null) edits.push({ oldText: m[1], newText: m[2] })
  return edits.length ? { path, edits } : null
}

function EditBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const parsed = parseEditContent(content)

  if (!parsed) {
    // Fallback: show raw content in a code block
    return (
      <div className="mb-2" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
          <PenLine size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Edit</span>
        </div>
        <pre className="text-xs px-3 py-2" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{content}</pre>
      </div>
    )
  }

  const filename = parsed.path.split('/').pop() ?? parsed.path
  const n = parsed.edits.length

  return (
    <div className="mb-2" style={{ border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
        style={{ background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))', borderBottom: expanded ? '1px solid var(--border)' : 'none' }}
        onClick={() => setExpanded(v => !v)}
      >
        <PenLine size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Edit</span>
        <span className="text-xs font-mono font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{filename}</span>
        <span className="text-xs ml-auto shrink-0" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          {n} edit{n !== 1 ? 's' : ''}
        </span>
        <ChevronDown size={11} style={{ color: 'var(--text-secondary)', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </div>

      {/* Path */}
      {expanded && (
        <div className="px-3 py-1.5 text-xs font-mono truncate" style={{ color: 'var(--text-secondary)', opacity: 0.6, borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
          {parsed.path}
        </div>
      )}

      {/* Diffs */}
      {expanded && parsed.edits.map((e, i) => (
        <div key={i} style={{ borderBottom: i < parsed.edits.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <div className="px-3 py-1.5 text-xs font-mono" style={{ background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-primary))', color: 'var(--danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {'− '}{e.oldText}
          </div>
          <div className="px-3 py-1.5 text-xs font-mono" style={{ background: 'color-mix(in srgb, var(--success) 8%, var(--bg-primary))', color: 'var(--success)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {'+ '}{e.newText}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Generic gateway action pill (self-closing / unknown content tags) ─────────

function looksLikeJson(v: string): boolean {
  const t = v.trim()
  return (t.startsWith('{') || t.startsWith('[')) && (t.endsWith('}') || t.endsWith(']'))
}

function prettyJson(v: string): string {
  try { return JSON.stringify(JSON.parse(v), null, 2) } catch { return v }
}

function ActionPill({ resource, action, scalarAttrs, jsonAttrs, inlineContent }: {
  resource: string
  action: string
  scalarAttrs: [string, string][]
  jsonAttrs: [string, string][]
  inlineContent?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasExpando = jsonAttrs.length > 0

  return (
    <div style={{ border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border))', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs"
        style={{ background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))', cursor: hasExpando ? 'pointer' : 'default' }}
        onClick={() => hasExpando && setExpanded(v => !v)}
      >
        <Zap size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{resource}</span>
        {action && <><span style={{ color: 'var(--text-secondary)', opacity: 0.4 }}>·</span><span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{action}</span></>}
        {scalarAttrs.map(([k, v]) => (
          <span key={k} className="font-mono" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
            {k}=<span style={{ color: 'var(--text-primary)' }}>{v.length > 48 ? v.slice(0, 48) + '…' : v}</span>
          </span>
        ))}
        {inlineContent && !action && (
          <span className="font-mono truncate flex-1" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
            {inlineContent.slice(0, 60)}{inlineContent.length > 60 ? '…' : ''}
          </span>
        )}
        {hasExpando && (
          <ChevronDown size={11} style={{ color: 'var(--text-secondary)', marginLeft: 'auto', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        )}
      </div>
      {/* JSON payload(s) */}
      {expanded && jsonAttrs.map(([k, v]) => (
        <div key={k} style={{ borderTop: '1px solid var(--border)' }}>
          <div className="px-3 pt-1.5 pb-0.5 text-xs font-semibold" style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>{k}</div>
          <pre style={{ margin: 0, padding: '6px 12px 8px', fontSize: 11, fontFamily: 'monospace', background: 'var(--bg-primary)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>
            {prettyJson(v)}
          </pre>
        </div>
      ))}
    </div>
  )
}

function GatewayActionBlock({ actions }: { actions: GatewayAction[] }) {
  if (actions.length === 0) return null
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {actions.map((a, i) => {
        if (a.content !== undefined && a.resource === 'edit') {
          return <EditBlock key={i} content={a.content} />
        }
        const scalarAttrs = Object.entries(a.attrs).filter(([, v]) => !looksLikeJson(v))
        const jsonAttrs   = Object.entries(a.attrs).filter(([, v]) =>  looksLikeJson(v))
        return (
          <ActionPill key={i} resource={a.resource} action={a.action} scalarAttrs={scalarAttrs} jsonAttrs={jsonAttrs} inlineContent={a.content} />
        )
      })}
    </div>
  )
}

// ── Message feedback (thumbs up / down) ──────────────────────────────────────

function MessageFeedback({ message }: { message: ChatMessage }) {
  const { load, submit, getRating } = useFeedbackStore()
  const [saving, setSaving] = useState(false)

  // Load JSONL ratings from disk once per app session (idempotent)
  useEffect(() => { load() }, [])

  const rating = getRating(message.id)

  const handleSubmit = async (r: 'up' | 'down') => {
    if (rating || saving) return
    setSaving(true)
    await submit({
      ts: new Date().toISOString(),
      rating: r,
      sessionId: message.sessionId,
      messageId: message.id,
      model: message.model,
      preview: message.content.slice(0, 200).replace(/\n+/g, ' '),
    }).catch(() => {})
    setSaving(false)
  }

  const dim = 'var(--text-secondary)'
  const base: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '3px 5px', borderRadius: 'var(--radius)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.12s',
  }

  if (rating) {
    return (
      <div className="flex items-center gap-1 mt-1.5 opacity-50">
        {rating === 'up'
          ? <ThumbsUp size={11} style={{ color: 'var(--success)' }} />
          : <ThumbsDown size={11} style={{ color: 'var(--warning)' }} />
        }
        <span style={{ fontSize: 10, color: dim }}>Thanks for the feedback</span>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-0.5 mt-1.5 feedback-bar"
      style={{ opacity: 0, transition: 'opacity 0.15s' }}
    >
      <button
        title="Good response"
        style={{ ...base, color: dim }}
        disabled={saving}
        onClick={() => handleSubmit('up')}
        onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--success) 12%, transparent)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        title="Bad response"
        style={{ ...base, color: dim }}
        disabled={saving}
        onClick={() => handleSubmit('down')}
        onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in srgb, var(--warning) 12%, transparent)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        <ThumbsDown size={12} />
      </button>
    </div>
  )
}

interface Props { message: ChatMessage; showTools?: boolean; showReasoning?: boolean }

export function AssistantMessage({ message, showTools = true, showReasoning = true }: Props) {
  const stripped = stripProtocolTags(message.content)
  const { actions: gatewayActions, text: noActions } = extractGatewayActions(stripped)
  const { thinking: inlineThinking, text: cleanContent } = extractThinkTags(noActions)
  const allReasoning = [message.reasoning, inlineThinking].filter(Boolean).join('\n\n')
  const hasReasoning = !!allReasoning
  const hasTools = !!(message.toolCalls?.length)

  // Stale streaming detection: if streaming but no content updates for STALE_THRESHOLD_MS, show waiting indicator
  const [isStale, setIsStale] = useState(false)
  const runningToolCount = message.toolCalls?.filter(tc => tc.status === 'running').length ?? 0
  // Live prompt-token ingestion (Ollama). The model isn't stalled while this is
  // advancing — it just hasn't emitted a token yet — so feed it into the activity key
  // (resets the stale timer) and suppress the "model stopped" banner below.
  const promptProgress = useOllamaProgress(s => s.progress)
  // Include running tool count so the timer resets on tool_start and tool_done transitions
  const activityKey = `${message.content.length}:${message.reasoning?.length ?? 0}:${message.toolCalls?.length ?? 0}:${runningToolCount}:${promptProgress ?? ''}`
  const prevActivityKey = useRef(activityKey)

  useEffect(() => {
    if (!message.streaming) { setIsStale(false); return }
    if (activityKey !== prevActivityKey.current) {
      prevActivityKey.current = activityKey
      setIsStale(false)
    }
    const t = setTimeout(() => setIsStale(true), STALE_THRESHOLD_MS)
    return () => clearTimeout(t)
  }, [message.streaming, activityKey])

  // A running tool call is not "waiting" — suppress the indicator while tools are actively executing
  const hasRunningTool = runningToolCount > 0
  const isWaitingForSession = message.streaming && !hasRunningTool && !!message.waitingForSession
  const isStalled = isStale && message.streaming && !hasRunningTool && !message.waitingForSession && promptProgress == null

  const chatMode = useSettingsStore(s => s.chatMode)
  const [showDetails, setShowDetails] = useState(false)

  // ── Basic mode: a calm, plain-language activity trail instead of tool/reasoning cards ──
  if (chatMode === 'basic') {
    const cur = currentActivity(message, promptProgress)
    const steps = completedSteps(message)
    const hasDetails = hasReasoning || hasTools || gatewayActions.length > 0
    return (
      <div className="flex justify-start animate-fade-in">
        <div className="max-w-[85%] min-w-0 w-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Assistant</span>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatTimestamp(message.createdAt)}</span>
          </div>

          {message.interrupted && <InterruptedNotice />}

          {/* Activity trail while working: completed steps + the current action, live */}
          {message.streaming && !isStalled && (cur || steps.length > 0) && (
            <div className="mb-2 flex flex-col gap-1.5">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
                  <span>{s.label}{s.count > 1 ? ` · ${s.count}×` : ''}</span>
                </div>
              ))}
              {cur && (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--accent)' }}>
                  <cur.Icon size={13} className="animate-pulse-dot" style={{ flexShrink: 0 }} />
                  <span>{cur.label}…</span>
                </div>
              )}
            </div>
          )}

          {/* Gentle stall notice */}
          {isStalled && (
            <div className="mb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              Paused — send a message to continue.
            </div>
          )}

          {/* The answer */}
          {(cleanContent || (message.streaming && !cur && !isStalled) || message.attachments?.length) && (
            <div className="px-4 py-3 text-sm" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', lineHeight: 1.7 }}>
              {cleanContent ? (
                <MarkdownContent text={cleanContent} streaming={message.streaming} />
              ) : message.streaming ? (
                <span className="streaming-cursor" style={{ color: 'var(--text-secondary)' }} />
              ) : null}
              {message.attachments?.filter(a => a.type === 'image').map((a, i) => (
                <WorkspaceImage key={i} src={a.url ?? `data:${a.mediaType ?? 'image/png'};base64,${a.data}`} alt={a.name} />
              ))}
              {message.attachments?.filter(a => a.type === 'video').map((a, i) => (
                <VideoPlayer key={i} src={a.url ?? ''} name={a.name} />
              ))}
              {message.attachments?.filter(a => a.type === 'audio').map((a, i) => (
                <AudioPlayer key={i} attachment={a} />
              ))}
            </div>
          )}

          {/* Completed-steps recap + opt-in Details (full advanced view for this message) */}
          {!message.streaming && hasDetails && (
            <div className="mt-1.5">
              {steps.length > 0 && !showDetails && (
                <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {steps.map((s, i) => (
                    <span key={i} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                      <CheckCircle2 size={11} style={{ color: 'var(--success)' }} />{s.label}{s.count > 1 ? ` ${s.count}×` : ''}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowDetails(v => !v)}
                className="flex items-center gap-1 text-xs"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', opacity: 0.8, padding: 0 }}
              >
                <ChevronDown size={12} style={{ transform: showDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                {showDetails ? 'Hide details' : 'Details'}
              </button>
              {showDetails && (
                <div className="mt-2">
                  {hasReasoning && showReasoning && <ReasoningBlock text={allReasoning} streaming={false} />}
                  {gatewayActions.length > 0 && <GatewayActionBlock actions={gatewayActions} />}
                  {hasTools && <ToolCallsBlock calls={message.toolCalls!} />}
                </div>
              )}
            </div>
          )}

          {!message.streaming && cleanContent && <MessageFeedback message={message} />}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[85%] min-w-0 w-full">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Assistant</span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {formatTimestamp(message.createdAt)}
          </span>
          {message.streaming && !isWaitingForSession && !isStalled && (
            <div className="flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="text-xs" style={{ color: 'var(--accent)' }}>thinking…</span>
            </div>
          )}
          {isWaitingForSession && (
            <div className="flex items-center gap-1">
              <Hourglass size={10} className="animate-pulse-dot" style={{ color: 'var(--warning)' }} />
              <span className="text-xs" style={{ color: 'var(--warning)' }}>waiting for session…</span>
            </div>
          )}
          {isStalled && (
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: 'var(--danger)' }}>model stopped — send a message to continue</span>
            </div>
          )}
        </div>

        {message.interrupted && <InterruptedNotice />}

        {/* Reasoning block */}
        {hasReasoning && showReasoning && (
          <ReasoningBlock
            text={allReasoning}
            streaming={(message.reasoningStreaming) || (!!inlineThinking && (message.streaming ?? false))}
          />
        )}

        {/* Gateway XML action tags */}
        {gatewayActions.length > 0 && (
          <GatewayActionBlock actions={gatewayActions} />
        )}

        {/* Tool calls */}
        {hasTools && showTools && (
          <ToolCallsBlock calls={message.toolCalls!} />
        )}

        {/* Waiting for sub-session indicator */}
        {isWaitingForSession && (
          <WaitingBlock sessionKey={message.waitingForSession} />
        )}

        {/* Context overflow indicator */}
        {message.contextOverflow && (
          <OverflowBlock overflow={message.contextOverflow} />
        )}

        {/* Message content */}
        {(cleanContent || message.streaming || message.attachments?.length) && (
          <div
            className="px-4 py-3 text-sm"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              borderTopLeftRadius: (hasReasoning || hasTools) ? 4 : undefined,
              lineHeight: 1.7
            }}
          >
            {cleanContent ? (
              <MarkdownContent text={cleanContent} streaming={message.streaming} />
            ) : (message.streaming && !hasReasoning && !hasTools && !isWaitingForSession) ? (
              <PromptProgress />
            ) : (
              <span className="streaming-cursor" style={{ color: 'var(--text-secondary)' }} />
            )}
            {message.attachments?.filter(a => a.type === 'image').map((a, i) => (
              <WorkspaceImage key={i} src={a.url ?? `data:${a.mediaType ?? 'image/png'};base64,${a.data}`} alt={a.name} />
            ))}
            {message.attachments?.filter(a => a.type === 'video').map((a, i) => (
              <VideoPlayer key={i} src={a.url ?? ''} name={a.name} />
            ))}
            {message.attachments?.filter(a => a.type === 'audio').map((a, i) => (
              <AudioPlayer key={i} attachment={a} />
            ))}
          </div>
        )}

        {/* Feedback row — hidden until parent is hovered */}
        {!message.streaming && cleanContent && (
          <MessageFeedback message={message} />
        )}
      </div>
    </div>
  )
}

// ── Gateway-restart / connection-drop notice ──────────────────────────────────
// Rendered on a message whose turn was cut off by a gateway drop. Reads live
// connection status so it flips from "reconnecting…" to "back online" on its own —
// that flip IS the wake-up the user is waiting for.
function InterruptedNotice() {
  const status = useConnectionStore(s => s.status)
  const back = status === 'connected'
  return (
    <div
      className="flex items-center gap-2 mb-2 px-3 py-2 text-xs rounded"
      style={{ background: 'var(--bg-elevated)', border: `1px solid ${back ? 'var(--success)' : 'var(--warning)'}`, color: back ? 'var(--success)' : 'var(--warning)' }}
    >
      {back ? <CheckCircle2 size={13} style={{ flexShrink: 0 }} /> : <Loader2 size={13} className="animate-spin" style={{ flexShrink: 0 }} />}
      <span>
        {back
          ? 'Gateway restarted and is back online — send a message to continue.'
          : 'The gateway connection dropped (it may be restarting) — reconnecting…'}
      </span>
    </div>
  )
}

// ── Prompt-processing progress (Ollama) ───────────────────────────────────────
// Shown before the first token while the local Ollama runner is still ingesting
// the prompt. Falls back to the plain streaming cursor when no progress is
// available (short prompts, remote/non-Ollama models, or non-Electron runtime).

function PromptProgress() {
  const { progress, nTokens, tps } = useOllamaProgress()

  // Start the main-process log watcher on first appearance, and clear the bar when
  // this prompt-processing phase ends (output starts / turn finishes) so it doesn't
  // linger or carry into the next turn.
  useEffect(() => {
    useOllamaProgress.getState().ensureStarted()
    return () => useOllamaProgress.getState().reset()
  }, [])

  if (progress == null) {
    return <span className="streaming-cursor" style={{ color: 'var(--text-secondary)' }} />
  }

  const pct = Math.min(Math.round(progress * 100), 100)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--accent)' }}>Processing prompt… {pct}%</span>
        {nTokens != null && (
          <span style={{ opacity: 0.65 }}>
            · {nTokens.toLocaleString()} tokens{tps ? ` · ${Math.round(tps)} tok/s` : ''}
          </span>
        )}
      </div>
      <div style={{ height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

// ── Reasoning block ───────────────────────────────────────────────────────────

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true)

  // Auto-open while streaming, keep state after done
  const isOpen = streaming ? true : open

  return (
    <div
      className="reasoning-block mb-2"
      style={{ borderRadius: 'var(--radius)', overflow: 'hidden' }}
    >
      <button
        onClick={() => !streaming && setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
        style={{
          background: 'none',
          border: 'none',
          cursor: streaming ? 'default' : 'pointer',
          color: 'var(--text-secondary)',
          fontSize: 12,
          fontWeight: 500
        }}
      >
        <BrainCircuit size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ color: 'var(--accent)' }}>Reasoning</span>
        {streaming && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />}
        {!streaming && (isOpen
          ? <ChevronDown size={12} className="ml-auto" />
          : <ChevronRight size={12} className="ml-auto" />
        )}
        {!streaming && <span className="text-xs opacity-50">{text.length} chars</span>}
      </button>

      {isOpen && (
        <div
          className="px-3 pb-3 text-xs"
          style={{
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
            fontStyle: 'italic'
          }}
        >
          {text}
          {streaming && <span className="streaming-cursor" />}
        </div>
      )}
    </div>
  )
}

// ── Tool type detection ───────────────────────────────────────────────────────

type ToolKind = 'bash' | 'file-write' | 'file-read' | 'file-search' | 'web' | 'gateway' | 'agent' | 'unknown'

function detectKind(name: string): ToolKind {
  const n = name.toLowerCase()
  if (/\bbash\b|shell|run_command|execute_command|run_bash|terminal/.test(n)) return 'bash'
  if (/write_file|create_file|overwrite|str_replace_editor|patch_file|edit_file|\bwrite\b|\bedit\b/.test(n)) return 'file-write'
  if (/read_file|view_file|cat_file|\bread\b|\bview\b|\bopen\b/.test(n)) return 'file-read'
  if (/search_files|find_files|\bgrep\b|\bfind\b|\bglob\b|list_files|ls_files/.test(n)) return 'file-search'
  if (/web_search|web_fetch|\bsearch\b(?!.*file)/.test(n)) return 'web'
  if (/http_request|\bfetch\b|\bbrowse\b/.test(n)) return 'web'
  if (/gateway|config.*patch|patch.*config|openclaw/.test(n)) return 'gateway'
  if (/run_agent|spawn_session|send.*message|agent_call/.test(n)) return 'agent'
  return 'unknown'
}

const KIND_ICON: Record<ToolKind, React.ReactNode> = {
  'bash':        <Terminal size={12} style={{ color: 'var(--warning)', flexShrink: 0 }} />,
  'file-write':  <PenLine size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />,
  'file-read':   <FileText size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />,
  'file-search': <FolderSearch size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />,
  'web':         <Globe size={12} style={{ color: 'var(--success)', flexShrink: 0 }} />,
  'gateway':     <Plug size={12} style={{ color: 'var(--warning)', flexShrink: 0 }} />,
  'agent':       <Bot size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />,
  'unknown':     <Wrench size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />,
}

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {}
  try { return JSON.parse(args) as Record<string, unknown> } catch { return { raw: args } }
}

function toolSummary(kind: ToolKind, args?: string): string {
  const a = parseArgs(args)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  if (kind === 'bash') {
    const cmd = str(a.command ?? a.cmd ?? a.script ?? a.raw)
    return cmd.replace(/\s*\n\s*/g, ' → ').replace(/\s{2,}/g, ' ')
  }
  if (kind === 'file-write') {
    const path = str(a.path ?? a.file_path ?? a.filename ?? a.target_file)
    const content = str(a.content ?? a.new_content ?? a.new_string)
    const base = path.split('/').pop() ?? path
    return base + (content ? ` (${content.length} chars)` : '')
  }
  if (kind === 'file-read') {
    const path = str(a.path ?? a.file_path ?? a.filename)
    return path || str(a.raw)
  }
  if (kind === 'file-search') {
    const pat = str(a.pattern ?? a.regex ?? a.query ?? a.name)
    const path = str(a.path ?? a.directory ?? a.dir)
    return [pat ? `"${pat}"` : '', path ? `in ${path}` : ''].filter(Boolean).join(' ')
  }
  if (kind === 'web') {
    return str(a.url ?? a.query ?? a.raw)
  }
  if (kind === 'gateway') {
    const keys = Object.keys(a).filter(k => k !== 'raw')
    return keys.length ? `Updating ${keys.join(', ')}` : 'Config update'
  }
  if (kind === 'agent') {
    return str(a.agentId ?? a.agent_id ?? a.sessionKey ?? a.session_key ?? a.message ?? a.raw)
  }
  return args ? truncate(args, 80) : ''
}

function toolDisplayName(name: string, kind: ToolKind): string {
  if (kind === 'bash') return 'Bash'
  if (kind === 'file-write') return 'Write'
  if (kind === 'file-read') return 'Read'
  if (kind === 'file-search') return 'Find'
  if (kind === 'web') return 'Web'
  if (kind === 'gateway') return 'Gateway'
  if (kind === 'agent') return 'Agent'
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Tool calls block ──────────────────────────────────────────────────────────

function ToolCallsBlock({ calls }: { calls: ToolCall[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const plugins = useExtensionsStore(s => s.plugins)
  const toggle = (id: string) => setExpanded(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {calls.map(call => {
        const kind = detectKind(call.name)
        const summary = toolSummary(kind, call.args)
        const displayName = toolDisplayName(call.name, kind)
        const isOpen = expanded.has(call.id)
        const a = parseArgs(call.args)
        const plugin = call.pluginId ? plugins.find(p => p.id === call.pluginId) : undefined

        return (
          <div
            key={call.id}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden'
            }}
          >
            {/* Row header */}
            <div
              className="tool-call-row cursor-pointer"
              style={{ padding: '6px 10px' }}
              onClick={() => toggle(call.id)}
            >
              {isOpen
                ? <ChevronDown size={11} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                : <ChevronRight size={11} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              }
              {KIND_ICON[kind]}
              <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)', flexShrink: 0 }}>
                {displayName}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded font-mono"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', flexShrink: 0, fontSize: 10 }}
              >
                {call.name}
              </span>
              {plugin && (
                <span
                  className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
                  style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', flexShrink: 0, fontSize: 10 }}
                  title={`Plugin: ${plugin.id}`}
                >
                  <Plug size={9} />
                  {plugin.name ?? plugin.id}
                </span>
              )}
              {summary && (
                <span className="text-xs truncate flex-1" style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  {summary}
                </span>
              )}
              <div className="flex items-center gap-1.5 ml-auto pl-2 shrink-0">
                {call.durationMs !== undefined && call.status !== 'running' && (
                  <span className="flex items-center gap-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <Clock size={9} />
                    {call.durationMs < 1000 ? `${call.durationMs}ms` : `${(call.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                <ToolStatusIcon status={call.status} />
              </div>
            </div>

            {/* Expanded detail */}
            {isOpen && (
              <div
                className="text-xs"
                style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}
              >
                <ToolDetail kind={kind} name={call.name} args={a} rawArgs={call.args} result={call.result} error={call.error} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ToolDetail({ kind, name, args, rawArgs, result, error }: {
  kind: ToolKind; name: string; args: Record<string, unknown>; rawArgs?: string; result?: string; error?: string
}) {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const codeBlock = (content: string, lang?: string) => (
    <pre
      style={{
        margin: 0, padding: '10px 12px', fontSize: 11,
        overflowX: 'auto', fontFamily: 'monospace', lineHeight: 1.6,
        background: 'var(--bg-primary)', color: 'var(--text-primary)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all'
      }}
    >
      {lang && <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{lang}{'\n'}</span>}
      {content}
    </pre>
  )

  let inputSection: React.ReactNode = null
  let resultSection: React.ReactNode = null

  if (kind === 'bash') {
    const cmd = str(args.command ?? args.cmd ?? args.script)
    const env = args.env
    inputSection = cmd ? (
      <div>
        {env && <p className="px-3 pt-2 pb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>Command</p>}
        {codeBlock(cmd, '$ ')}
      </div>
    ) : null

  } else if (kind === 'file-write') {
    const path = str(args.path ?? args.file_path ?? args.filename ?? args.target_file)
    const content = str(args.content ?? args.new_content)
    const oldStr = str(args.old_string)
    const newStr = str(args.new_string)
    inputSection = (
      <div>
        {path && <p className="px-3 pt-2 pb-1 text-xs font-mono" style={{ color: 'var(--accent)' }}>{path}</p>}
        {oldStr && newStr ? (
          <>
            <p className="px-3 py-1 font-medium" style={{ color: 'var(--danger)', fontSize: 10 }}>- old</p>
            {codeBlock(oldStr)}
            <p className="px-3 py-1 font-medium" style={{ color: 'var(--success)', fontSize: 10 }}>+ new</p>
            {codeBlock(newStr)}
          </>
        ) : content ? codeBlock(content) : null}
      </div>
    )

  } else if (kind === 'file-read') {
    const path = str(args.path ?? args.file_path ?? args.filename)
    inputSection = path ? <p className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--accent)' }}>{path}</p> : null

  } else if (kind === 'file-search') {
    const pattern = str(args.pattern ?? args.regex ?? args.query ?? args.name)
    const path = str(args.path ?? args.directory ?? args.dir)
    inputSection = (
      <div className="px-3 py-2 flex flex-col gap-1">
        {pattern && <p className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>Pattern: <span style={{ color: 'var(--accent)' }}>{pattern}</span></p>}
        {path && <p className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>Path: {path}</p>}
      </div>
    )

  } else if (kind === 'web') {
    const url = str(args.url ?? args.query)
    inputSection = url ? <p className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{url}</p> : null

  } else if (kind === 'gateway') {
    inputSection = rawArgs ? codeBlock(tryPrettyJson(rawArgs)) : null

  } else {
    // Generic: show pretty-printed args
    inputSection = rawArgs ? (
      <div>
        <p className="px-3 pt-2 pb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>Input</p>
        {codeBlock(tryPrettyJson(rawArgs))}
      </div>
    ) : null
  }

  // Result section
  if (error) {
    resultSection = (
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <p className="px-3 pt-2 pb-1 font-medium" style={{ color: 'var(--danger)' }}>Error</p>
        {codeBlock(error)}
      </div>
    )
  } else if (result) {
    const pretty = tryPrettyJson(result)
    const lines = pretty.split('\n').length
    resultSection = (
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <p className="px-3 pt-2 pb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
          Output {lines > 1 ? `(${lines} lines)` : ''}
        </p>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {codeBlock(pretty)}
        </div>
      </div>
    )
  }

  if (!inputSection && !resultSection) return null
  return <>{inputSection}{resultSection}</>
}

function ToolStatusIcon({ status }: { status: ToolCall['status'] }) {
  if (status === 'done') return <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
  if (status === 'error') return <XCircle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
  if (status === 'running') return <Loader2 size={13} className="animate-spin" style={{ color: 'var(--warning)', flexShrink: 0 }} />
  return <div style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--border)', flexShrink: 0 }} />
}

function WaitingBlock({ sessionKey }: { sessionKey?: string }) {
  const [dots, setDots] = useState(1)

  useEffect(() => {
    const t = setInterval(() => setDots(d => d === 3 ? 1 : d + 1), 600)
    return () => clearInterval(t)
  }, [])

  const isKnown = sessionKey && sessionKey !== 'unknown'

  return (
    <div
      className="mb-2 flex items-center gap-2 px-3 py-2 text-xs"
      style={{
        background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
        borderRadius: 'var(--radius)',
        color: 'var(--warning)'
      }}
    >
      <Hourglass size={12} className="animate-pulse-dot" style={{ flexShrink: 0 }} />
      <span>
        Waiting for {isKnown ? (
          <span className="font-mono">{sessionKey.slice(0, 20)}{sessionKey.length > 20 ? '…' : ''}</span>
        ) : 'sub-session'} to finish
      </span>
      <span style={{ letterSpacing: 1, minWidth: '1.5ch' }}>{'.'.repeat(dots)}</span>
    </div>
  )
}

function OverflowBlock({ overflow }: { overflow: ContextOverflowInfo }) {
  const tokens = typeof overflow.compactionTokens === 'number'
    ? overflow.compactionTokens.toLocaleString()
    : null

  return (
    <div
      className="mb-2 flex flex-col gap-1.5 px-3 py-2.5 text-xs"
      style={{
        background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
        borderRadius: 'var(--radius)',
        color: 'var(--warning)'
      }}
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={13} style={{ flexShrink: 0 }} />
        <span>Context window exceeded</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {overflow.messages != null && tokens != null
          ? `The conversation reached ${overflow.messages} messages (${tokens} tokens), which is too long for the model.`
          : overflow.messages != null
          ? `The conversation reached ${overflow.messages} messages, which is too long for the model.`
          : overflow.error}
        {overflow.provider && (
          <span className="block mt-1 font-mono" style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.7 }}>
            {overflow.provider}
          </span>
        )}
      </div>
      <div style={{ color: 'var(--text-secondary)', opacity: 0.8 }}>
        Start a new conversation to continue.
      </div>
    </div>
  )
}

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s }
function tryPrettyJson(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}

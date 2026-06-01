import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, BrainCircuit, CheckCircle2, XCircle, Loader2, Clock, Hourglass, Terminal, PenLine, FileText, Search, Globe, Plug, Bot, Wrench, FolderSearch, AlertTriangle } from 'lucide-react'
import type { ChatMessage, ContextOverflowInfo, ToolCall } from '../../lib/types'
import { useExtensionsStore } from '../../store/extensions'
import { formatTimestamp } from '../../lib/dateUtils'
import { MarkdownContent } from './MarkdownContent'
import { AudioPlayer } from './AudioPlayer'
import { WorkspaceImage, VideoPlayer } from './WorkspaceMedia'

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

// Strip gateway protocol wrapper tags (<final>…</final>) from content
function stripProtocolTags(text: string): string {
  return text.replace(/<\/?final>/gi, '').trim()
}

interface Props { message: ChatMessage; showTools?: boolean; showReasoning?: boolean }

export function AssistantMessage({ message, showTools = true, showReasoning = true }: Props) {
  const { thinking: inlineThinking, text: cleanContent } = extractThinkTags(stripProtocolTags(message.content))
  const allReasoning = [message.reasoning, inlineThinking].filter(Boolean).join('\n\n')
  const hasReasoning = !!allReasoning
  const hasTools = !!(message.toolCalls?.length)

  // Stale streaming detection: if streaming but no content updates for STALE_THRESHOLD_MS, show waiting indicator
  const [isStale, setIsStale] = useState(false)
  const runningToolCount = message.toolCalls?.filter(tc => tc.status === 'running').length ?? 0
  // Include running tool count so the timer resets on tool_start and tool_done transitions
  const activityKey = `${message.content.length}:${message.reasoning?.length ?? 0}:${message.toolCalls?.length ?? 0}:${runningToolCount}`
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
  const isStalled = isStale && message.streaming && !hasRunningTool && !message.waitingForSession

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

        {/* Reasoning block */}
        {hasReasoning && showReasoning && (
          <ReasoningBlock
            text={allReasoning}
            streaming={(message.reasoningStreaming) || (!!inlineThinking && (message.streaming ?? false))}
          />
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

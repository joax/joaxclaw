import { useState, useEffect } from 'react'
import { Plus, Search, Trash2, MessageSquare, Radio, Heart, ExternalLink, ArrowLeftToLine } from 'lucide-react'
import { ModelIcon } from '../ui/ModelIcon'
import { useChatStore } from '../../store/chat'
import { useAgentsStore } from '../../store/agents'
import { useSessionsStore } from '../../store/sessions'
import { useModelsStore } from '../../store/models'
import { useSettingsStore } from '../../store/settings'
import { MessageThread } from './MessageThread'
import { ThemeBackground } from '../theme/ThemeBackground'
import { MessageInput } from './MessageInput'
import logoUrl from '../../assets/logo-dark.png'
import { ModelSelect, ThinkingSelect, DisplayMenu } from './ChatHeaderControls'
import { Btn } from '../ui/Btn'
import { formatRelativeDate } from '../../lib/dateUtils'
import type { Session } from '../../lib/types'
import { agentIdFromSessionKey as sessionAgentId, isAutoKeyTitle } from '../../lib/sessionName'

// `solo` runs ChatView inside a popped-out window: the sidebar is hidden and the view
// is locked to a single session (opened on mount), with a "return to main" control.
export function ChatView({ solo }: { solo?: string } = {}) {
  const { conversations, activeConvId, newConversation, selectConversation, deleteConversation, loadSessionMessages, watchSession, setModelOverride, setThinkingLevel } = useChatStore()
  const { agents, fetch: fetchAgents } = useAgentsStore()
  const { sessions, customLabels, derivedNames, fetch: fetchSessions } = useSessionsStore()
  const [search, setSearch] = useState('')
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showTools, setShowTools] = useState(true)
  const [showReasoning, setShowReasoning] = useState(true)
  const [showContext, setShowContext] = useState(true)
  // Sessions moved into their own windows — hidden from this (main) window's list.
  const [poppedOut, setPoppedOut] = useState<Set<string>>(new Set())
  const { load: loadModels } = useModelsStore()
  const chatMode = useSettingsStore(s => s.chatMode)
  const setChatMode = useSettingsStore(s => s.setChatMode)

  useEffect(() => { if (showContext) loadModels() }, [showContext])

  useEffect(() => { fetchAgents() }, [])

  // Poll sessions to detect newly spawned sub-sessions
  useEffect(() => {
    fetchSessions()
    const t = setInterval(fetchSessions, 12_000)
    return () => clearInterval(t)
  }, [])

  // Solo (pop-out) window: open the target session as the active conversation.
  useEffect(() => {
    if (!solo) return
    let cancelled = false
    void (async () => {
      const convId = await loadSessionMessages(solo, sessionAgentId(solo), sessionAgentId(solo))
      if (cancelled || !convId) return
      selectConversation(convId)
      watchSession(convId, solo)
    })()
    return () => { cancelled = true }
  }, [solo])

  // Main window: track which chats are popped out, and respond to a pop-out asking
  // to bring its chat back (open that session here).
  useEffect(() => {
    if (solo) return
    const api = window.api?.window
    api?.listPoppedOut?.().then(keys => setPoppedOut(new Set(keys)))
    const offPopped = api?.onPoppedOut?.(keys => setPoppedOut(new Set(keys)))
    const offFocus = api?.onFocusSession?.(async key => {
      // Reload from the gateway so we show the latest state (it may have advanced in
      // the pop-out); loadSessionMessages reuses the existing conversation if present.
      const convId = await loadSessionMessages(key, sessionAgentId(key), sessionAgentId(key))
      if (convId) selectConversation(convId)
    })
    return () => { offPopped?.(); offFocus?.() }
  }, [solo])

  const conversationSessionKeys = new Set(conversations.map(c => c.sessionKey).filter(Boolean))

  const TERMINAL = new Set(['idle', 'done', 'failed', 'killed', 'timeout'])
  const isRunning = (s: Session) => {
    if (s.status && TERMINAL.has(s.status)) return false
    // hasActiveRun: false overrides stale stored 'running' status
    if (s.hasActiveRun === false) return false
    if (s.status === 'running') return true
    return s.hasActiveRun ?? false
  }

  // Sessions that are running but not yet opened as conversations (and not popped out)
  const activeSessions = sessions.filter(s =>
    isRunning(s) && !conversationSessionKeys.has(s.key) && !poppedOut.has(s.key)
  )

  const agentName = (sessionKey: string) => {
    const id = sessionAgentId(sessionKey)
    const a = agents.find(ag => ag.id === id)
    return a?.identity?.name ?? a?.name ?? id
  }

  // Priority: user's explicit rename → app-derived name (e.g. Team sub-agents) →
  // gateway display name/label → agent name parsed from the key.
  const sessionDisplayName = (s: Session) =>
    customLabels[s.key] ?? derivedNames[s.key] ?? s.displayName ?? s.label ?? agentName(s.key)

  // Clean display name for a conversation, resolved at render so even conversations
  // saved with a raw key (before this fix, or opened outside the Team flow) read well.
  // A real title (a first message, or an already-clean agent name) is kept; only an
  // auto-derived key-title is replaced with the parsed agent name.
  const convDisplayName = (conv: { sessionKey?: string; title?: string; agentName?: string }) => {
    const key = conv.sessionKey
    if (!key) return conv.title || conv.agentName || ''
    if (customLabels[key]) return customLabels[key]
    if (derivedNames[key]) return derivedNames[key]
    if (conv.title && !isAutoKeyTitle(conv.title, key)) return conv.title
    return agentName(key)
  }

  const handleOpenSession = async (s: Session) => {
    const agentId = sessionAgentId(s.key)
    const convId = await loadSessionMessages(s.key, agentId, sessionDisplayName(s))
    if (convId && isRunning(s)) {
      watchSession(convId, s.key)
    }
  }

  const filtered = conversations.filter(c => {
    if (c.sessionKey && poppedOut.has(c.sessionKey)) return false   // shown in its own window
    const q = search.toLowerCase()
    return c.title.toLowerCase().includes(q) ||
      c.agentName.toLowerCase().includes(q) ||
      convDisplayName(c).toLowerCase().includes(q)
  })

  const activeConv = conversations.find(c => c.id === activeConvId)

  // Group by date
  type ConvGroup = { label: string; convs: typeof filtered }
  const groups: ConvGroup[] = []
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const todayConvs = filtered.filter(c => new Date(c.lastAt ?? c.messages[0]?.createdAt ?? Date.now()).toDateString() === today)
  const yestConvs = filtered.filter(c => new Date(c.lastAt ?? c.messages[0]?.createdAt ?? Date.now()).toDateString() === yesterday)
  const olderConvs = filtered.filter(c => {
    const d = new Date(c.lastAt ?? c.messages[0]?.createdAt ?? Date.now()).toDateString()
    return d !== today && d !== yesterday
  })
  if (todayConvs.length) groups.push({ label: 'Today', convs: todayConvs })
  if (yestConvs.length) groups.push({ label: 'Yesterday', convs: yestConvs })
  if (olderConvs.length) groups.push({ label: 'Earlier', convs: olderConvs })

  return (
    <div className="flex flex-1 min-h-0">
      {/* Sidebar — hidden in a popped-out (solo) window */}
      {!solo && (
      <div
        className="flex flex-col shrink-0"
        style={{
          width: 240,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)'
        }}
      >
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="flex-1 relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search chats…"
              style={{
                width: '100%', padding: '5px 8px 5px 26px', fontSize: 12,
                borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none'
              }}
            />
          </div>
          <div className="relative">
            <Btn size="sm" icon={<Plus size={13} />} onClick={() => setShowNewMenu(s => !s)} style={{ padding: '5px 8px' }}>
              {''}
            </Btn>
            {showNewMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-50 py-1 min-w-max"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
              >
                {agents.map(agent => (
                  <button
                    key={agent.id}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm"
                    style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-primary)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                    onClick={() => { newConversation(agent.id, agent.identity?.name ?? agent.name ?? agent.id); setShowNewMenu(false) }}
                  >
                    <span>🤖</span>
                    <span>{agent.identity?.name ?? agent.name ?? agent.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {/* Active sessions from the gateway */}
          {activeSessions.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <Radio size={11} className="animate-pulse-dot" style={{ color: 'var(--success)' }} />
                <p className="text-xs font-medium" style={{ color: 'var(--success)' }}>
                  Live Sessions
                </p>
                <span
                  className="text-xs px-1.5 py-0 rounded-full ml-auto"
                  style={{ background: 'color-mix(in srgb, var(--success) 20%, transparent)', color: 'var(--success)', fontSize: 10 }}
                >
                  {activeSessions.length}
                </span>
              </div>
              {activeSessions.map(s => (
                <SessionRow
                  key={s.key}
                  session={s}
                  agentName={sessionDisplayName(s)}
                  onClick={() => handleOpenSession(s)}
                />
              ))}
              <div style={{ borderBottom: '1px solid var(--border)', margin: '8px 8px 4px' }} />
            </div>
          )}

          {groups.length === 0 && activeSessions.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <MessageSquare size={24} className="mb-2 opacity-30" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {search ? 'No chats found' : 'Start a chat by clicking +'}
              </p>
            </div>
          )}

          {groups.map(group => (
            <div key={group.label} className="mb-2">
              <p className="text-xs font-medium px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                {group.label}
              </p>
              {group.convs.map(conv => (
                <ConvRow
                  key={conv.id}
                  conv={conv}
                  displayName={convDisplayName(conv)}
                  active={conv.id === activeConvId}
                  onSelect={() => selectConversation(conv.id)}
                  onDelete={() => deleteConversation(conv.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Chat area */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0 relative">
        <ThemeBackground slot="chat" />
        <div className="relative z-[1] flex flex-1 flex-col min-w-0 min-h-0">
        {activeConv ? (
          <>
            {/* Chat header */}
            <div
              className="flex items-center gap-3 px-4 py-2 shrink-0 text-sm"
              style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
            >
              <span>🤖</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {convDisplayName(activeConv)}
              </span>
              {activeConv.sessionKey && (
                <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  {activeConv.sessionKey.slice(0, 16)}
                </span>
              )}
              {activeConv.sessionKey?.includes(':heartbeat') && (
                <Heart size={12} title="Heartbeat session" style={{ color: 'var(--accent)', opacity: 0.8 }} />
              )}

              {/* Per-chat model + thinking overrides (independent of the agent's config) */}
              <div className="flex items-center gap-1.5 ml-2">
                <ModelSelect
                  value={activeConv.modelOverride}
                  agentDefault={agents.find(a => a.id === activeConv.agentId)?.model?.primary}
                  onChange={model => setModelOverride(activeConv.id, model)}
                />
                <ThinkingSelect
                  value={activeConv.thinkingLevel}
                  onChange={level => setThinkingLevel(activeConv.id, level)}
                />
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                {/* Presentation mode + Advanced multi-select toggles, collapsed into a
                    single popover so the header stays compact (esp. in the pop-out). */}
                <DisplayMenu
                  mode={chatMode}
                  setMode={setChatMode}
                  reasoning={showReasoning} setReasoning={setShowReasoning}
                  actions={showTools}       setActions={setShowTools}
                  context={showContext}     setContext={setShowContext}
                />
                {/* Move this chat to its own window — or, in a pop-out, bring it back. */}
                {solo ? (
                  <button
                    onClick={() => window.api?.window?.returnChat?.(solo)}
                    title="Return this chat to the main window"
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
                    style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    <ArrowLeftToLine size={12} /> Return
                  </button>
                ) : activeConv.sessionKey ? (
                  <button
                    onClick={() => { window.api?.window?.popOutChat?.(activeConv.sessionKey!); selectConversation('') }}
                    title="Open this chat in a new window"
                    className="flex items-center justify-center px-1.5 py-1 rounded transition-colors"
                    style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    <ExternalLink size={13} />
                  </button>
                ) : null}
              </div>
            </div>

            {showContext && activeConv.sessionKey && (
              <ContextBar sessionKey={activeConv.sessionKey} />
            )}
            <MessageThread conv={activeConv} showTools={showTools} showReasoning={showReasoning} />
            <MessageInput convId={activeConv.id} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <img src={logoUrl} alt="JoaxClaw" style={{ height: 56, width: 'auto', opacity: 0.9 }} />
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Start a conversation</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Select a chat or click + to start with an agent
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.001) return `$${usd.toPrecision(2)}`
  if (usd < 0.01)  return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

function ContextBar({ sessionKey }: { sessionKey: string }) {
  const session  = useSessionsStore(s => s.sessions.find(sess => sess.key === sessionKey))
  const providers = useModelsStore(s => s.providers)

  const modelDef = (() => {
    if (!session?.model) return undefined
    const raw = session.model
    const slash = raw.indexOf('/')
    const modelId    = slash >= 0 ? raw.slice(slash + 1) : raw
    const providerId = slash >= 0 ? raw.slice(0, slash) : session.modelProvider
    return providers[providerId ?? '']?.models.find(m => m.id === modelId)
  })()

  const contextWindow = modelDef?.contextWindow ?? session?.contextTokens

  // inputTokens = tokens in the model's last input (the context it actually saw).
  // totalTokens = inputTokens + outputTokens for the last run.
  // We prefer inputTokens for the fill bar because it matches what the model itself
  // would report when asked "how many tokens are in my context".
  const inp = session?.inputTokens
  const out = session?.outputTokens
  const contextSize = inp ?? session?.totalTokens   // input-only is more accurate

  const fillPct = contextSize != null && contextWindow
    ? Math.min((contextSize / contextWindow) * 100, 100)
    : null

  const fillColor = fillPct == null ? 'var(--accent)'
    : fillPct > 90 ? 'var(--danger)'
    : fillPct > 70 ? 'var(--warning)'
    : 'var(--success)'

  // Cost: prefer gateway-provided value, fall back to per-token calculation
  const costUsd = (() => {
    if (session?.estimatedCostUsd != null && session.estimatedCostUsd > 0) return session.estimatedCostUsd
    if (!modelDef?.cost) return null
    const i = inp ?? 0
    const o = out ?? 0
    if (!i && !o) return null
    return i * modelDef.cost.input + o * modelDef.cost.output
  })()

  if (!session) return null

  return (
    <div
      className="flex items-center gap-4 px-4 py-2 text-xs shrink-0 flex-wrap"
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
    >
      {/* Context size — what the model actually received as input */}
      {contextSize != null && (
        <div className="flex items-center gap-1.5">
          <span style={{ color: 'var(--text-secondary)' }}>Context</span>
          <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {contextSize.toLocaleString()}
          </span>
          {contextWindow && (
            <span style={{ color: 'var(--text-secondary)' }}>/ {contextWindow.toLocaleString()}</span>
          )}
          <span style={{ color: 'var(--text-secondary)' }}>tokens</span>
        </div>
      )}

      {/* Context window fill bar */}
      {fillPct != null && (
        <div className="flex items-center gap-1.5" style={{ minWidth: 80 }}>
          <div style={{ flex: 1, height: 4, background: 'var(--bg-primary)', borderRadius: 2 }}>
            <div style={{ width: `${fillPct}%`, height: '100%', background: fillColor, borderRadius: 2, transition: 'width 0.4s' }} />
          </div>
          <span className="font-mono" style={{ color: fillColor, minWidth: '3ch', textAlign: 'right' }}>
            {fillPct.toFixed(0)}%
          </span>
        </div>
      )}

      {/* Output tokens — size of the last response */}
      {out != null && (
        <span className="font-mono" title="Output tokens (last response)" style={{ color: 'var(--text-secondary)' }}>
          +{out.toLocaleString()} out
        </span>
      )}

      {/* Cost estimate */}
      {costUsd != null && (
        <div className="flex items-center gap-1">
          <span style={{ color: 'var(--text-secondary)' }}>Cost</span>
          <span className="font-mono font-semibold" style={{ color: costUsd > 0.1 ? 'var(--warning)' : 'var(--text-primary)' }}>
            {fmtCost(costUsd)}
          </span>
        </div>
      )}

      {/* Model */}
      {session.model && (
        <div className="flex items-center gap-1 ml-auto">
          <ModelIcon model={session.modelProvider ? `${session.modelProvider}/${session.model}` : session.model} size={10} />
          <span className="font-mono" style={{ color: 'var(--text-secondary)', fontSize: 10, opacity: 0.7 }}>
            {session.modelProvider ? `${session.modelProvider}/` : ''}{session.model}
          </span>
        </div>
      )}
    </div>
  )
}

function SessionRow({ session, agentName, onClick }: { session: Session; agentName: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const age = session.startedAt ? formatRelativeDate(new Date(session.startedAt).toISOString()) : null

  return (
    <div
      className="flex flex-col px-2 py-2 rounded cursor-pointer"
      style={{
        background: hovered ? 'color-mix(in srgb, var(--success) 8%, var(--bg-elevated))' : 'transparent',
        borderRadius: 'var(--radius)',
        marginBottom: 1
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse-dot flex-shrink-0"
          style={{ background: 'var(--success)' }}
        />
        <p className="text-sm flex-1 truncate font-medium" style={{ color: 'var(--text-primary)' }}>
          {agentName}
        </p>
        {(session.isHeartbeat || session.key.includes(':heartbeat')) && (
          <Heart size={11} title="Heartbeat session" style={{ color: 'var(--accent)', opacity: 0.8, flexShrink: 0 }} />
        )}
        {age && (
          <span className="text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>{age}</span>
        )}
      </div>
      <p className="text-xs font-mono truncate ml-3" style={{ color: 'var(--text-secondary)' }}>
        {session.key.slice(0, 24)}{session.key.length > 24 ? '…' : ''}
      </p>
    </div>
  )
}

function ConvRow({ conv, displayName, active, onSelect, onDelete }: {
  conv: { id: string; title: string; agentName: string; lastMessage?: string; lastAt?: string; messages: { createdAt: string }[] }
  displayName: string
  active: boolean; onSelect: () => void; onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const date = conv.lastAt ?? conv.messages[0]?.createdAt
  return (
    <div
      className="relative flex flex-col px-2 py-2 rounded cursor-pointer"
      style={{
        background: active ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : hovered ? 'var(--bg-elevated)' : 'transparent',
        borderRadius: 'var(--radius)',
        marginBottom: 1
      }}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-1">
        <p className="text-sm flex-1 truncate font-medium" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>
          {displayName || conv.title}
        </p>
        {date && <span className="text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>{formatRelativeDate(date)}</span>}
      </div>
      {conv.lastMessage && (
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{conv.lastMessage}</p>
      )}
      {hovered && (
        <button
          className="absolute right-1.5 top-1.5 p-1 rounded"
          style={{ background: 'var(--bg-primary)', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}

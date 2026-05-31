import { useState, useEffect } from 'react'
import { Plus, Search, Trash2, MessageSquare, Wrench, Brain, Radio, Heart, Layers } from 'lucide-react'
import { useChatStore } from '../../store/chat'
import { useAgentsStore } from '../../store/agents'
import { useSessionsStore } from '../../store/sessions'
import { useModelsStore } from '../../store/models'
import { MessageThread } from './MessageThread'
import { MessageInput } from './MessageInput'
import { Btn } from '../ui/Btn'
import { formatRelativeDate } from '../../lib/dateUtils'
import type { Session } from '../../lib/types'

function sessionAgentId(key: string): string {
  const i = key.indexOf('@')
  return i > 0 ? key.slice(0, i) : key
}

export function ChatView() {
  const { conversations, activeConvId, newConversation, selectConversation, deleteConversation, loadSessionMessages, watchSession } = useChatStore()
  const { agents, fetch: fetchAgents } = useAgentsStore()
  const { sessions, customLabels, fetch: fetchSessions } = useSessionsStore()
  const [search, setSearch] = useState('')
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showTools, setShowTools] = useState(true)
  const [showReasoning, setShowReasoning] = useState(true)
  const [showContext, setShowContext] = useState(false)
  const { load: loadModels } = useModelsStore()

  useEffect(() => { if (showContext) loadModels() }, [showContext])

  useEffect(() => { fetchAgents() }, [])

  // Poll sessions to detect newly spawned sub-sessions
  useEffect(() => {
    fetchSessions()
    const t = setInterval(fetchSessions, 12_000)
    return () => clearInterval(t)
  }, [])

  const conversationSessionKeys = new Set(conversations.map(c => c.sessionKey).filter(Boolean))

  const TERMINAL = new Set(['idle', 'done', 'failed', 'killed', 'timeout'])
  const isRunning = (s: Session) => {
    if (s.status && TERMINAL.has(s.status)) return false
    // hasActiveRun: false overrides stale stored 'running' status
    if (s.hasActiveRun === false) return false
    if (s.status === 'running') return true
    return s.hasActiveRun ?? false
  }

  // Sessions that are running but not yet opened as conversations
  const activeSessions = sessions.filter(s =>
    isRunning(s) && !conversationSessionKeys.has(s.key)
  )

  const agentName = (sessionKey: string) => {
    const id = sessionAgentId(sessionKey)
    const a = agents.find(ag => ag.id === id)
    return a?.identity?.name ?? a?.name ?? id
  }

  const sessionDisplayName = (s: Session) =>
    customLabels[s.key] ?? s.displayName ?? s.label ?? agentName(s.key)

  const handleOpenSession = async (s: Session) => {
    const agentId = sessionAgentId(s.key)
    const convId = await loadSessionMessages(s.key, agentId, sessionDisplayName(s))
    if (convId && isRunning(s)) {
      watchSession(convId, s.key)
    }
  }

  const filtered = conversations.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    c.agentName.toLowerCase().includes(search.toLowerCase())
  )

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
      {/* Sidebar */}
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
                  active={conv.id === activeConvId}
                  onSelect={() => selectConversation(conv.id)}
                  onDelete={() => deleteConversation(conv.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {activeConv ? (
          <>
            {/* Chat header */}
            <div
              className="flex items-center gap-3 px-4 py-2 shrink-0 text-sm"
              style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
            >
              <span>🤖</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {(activeConv.sessionKey && customLabels[activeConv.sessionKey]) ?? activeConv.agentName}
              </span>
              {activeConv.sessionKey && (
                <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  {activeConv.sessionKey.slice(0, 16)}
                </span>
              )}
              {activeConv.sessionKey?.includes(':heartbeat') && (
                <Heart size={12} title="Heartbeat session" style={{ color: 'var(--accent)', opacity: 0.8 }} />
              )}
              <div className="ml-auto flex items-center gap-1">
                <ToggleBtn
                  active={showReasoning}
                  onClick={() => setShowReasoning(v => !v)}
                  icon={<Brain size={12} />}
                  label="Reasoning"
                />
                <ToggleBtn
                  active={showTools}
                  onClick={() => setShowTools(v => !v)}
                  icon={<Wrench size={12} />}
                  label="Actions"
                />
                <ToggleBtn
                  active={showContext}
                  onClick={() => setShowContext(v => !v)}
                  icon={<Layers size={12} />}
                  label="Context"
                />
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
            <span className="text-5xl">🦞</span>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Start a conversation</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Select a chat or click + to start with an agent
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ContextBar({ sessionKey }: { sessionKey: string }) {
  const session = useSessionsStore(s => s.sessions.find(sess => sess.key === sessionKey))
  const providers = useModelsStore(s => s.providers)

  const contextWindow = (() => {
    if (!session?.model) return undefined
    const raw = session.model
    const slash = raw.indexOf('/')
    const modelId = slash >= 0 ? raw.slice(slash + 1) : raw
    const providerId = slash >= 0 ? raw.slice(0, slash) : session.modelProvider
    return providers[providerId ?? '']?.models.find(m => m.id === modelId)?.contextWindow
  })()

  const tokens = session?.totalTokens

  const fillPct = tokens != null && contextWindow
    ? Math.min((tokens / contextWindow) * 100, 100)
    : null

  const fillColor = fillPct == null ? 'var(--accent)'
    : fillPct > 90 ? 'var(--danger)'
    : fillPct > 70 ? 'var(--warning)'
    : 'var(--success)'

  if (!session) return null

  return (
    <div
      className="flex items-center gap-4 px-4 py-2 text-xs shrink-0"
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
    >
      <div className="flex items-center gap-1.5">
        <span style={{ color: 'var(--text-secondary)' }}>Context</span>
        <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
          {tokens != null ? tokens.toLocaleString() : '—'}
        </span>
        {contextWindow && (
          <span style={{ color: 'var(--text-secondary)' }}>/ {contextWindow.toLocaleString()}</span>
        )}
        <span style={{ color: 'var(--text-secondary)' }}>tokens</span>
      </div>

      {fillPct != null && (
        <div className="flex items-center gap-1.5" style={{ minWidth: 120 }}>
          <div style={{ flex: 1, height: 4, background: 'var(--bg-primary)', borderRadius: 2 }}>
            <div style={{ width: `${fillPct}%`, height: '100%', background: fillColor, borderRadius: 2, transition: 'width 0.4s' }} />
          </div>
          <span className="font-mono" style={{ color: fillColor, minWidth: '3ch', textAlign: 'right' }}>
            {fillPct.toFixed(0)}%
          </span>
        </div>
      )}

      {session.model && (
        <span className="font-mono ml-auto" style={{ color: 'var(--text-secondary)', fontSize: 10, opacity: 0.7 }}>
          {session.modelProvider ? `${session.modelProvider}/` : ''}{session.model}
        </span>
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

function ToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      title={`${active ? 'Hide' : 'Show'} ${label}`}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-opacity"
      style={{
        border: '1px solid var(--border)',
        background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: 'pointer',
        opacity: active ? 1 : 0.6
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function ConvRow({ conv, active, onSelect, onDelete }: {
  conv: { id: string; title: string; agentName: string; lastMessage?: string; lastAt?: string; messages: { createdAt: string }[] }
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
          {conv.title}
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

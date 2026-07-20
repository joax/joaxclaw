import { useState, useEffect, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react'
import { Plus, Search, Trash2, MessageSquare, Radio, Heart, ExternalLink, ArrowLeftToLine, ChevronDown, Pencil, Clock } from 'lucide-react'
import { ModelIcon } from '../ui/ModelIcon'
import { useChatStore } from '../../store/chat'
import { useAgentsStore } from '../../store/agents'
import { useSessionsStore } from '../../store/sessions'
import { useCronsStore } from '../../store/crons'
import { cronJobForSession } from '../../lib/reminders'
import { useModelsStore } from '../../store/models'
import { useSettingsStore } from '../../store/settings'
import { MessageThread } from './MessageThread'
import { ThemeBackground } from '../theme/ThemeBackground'
import { MessageInput } from './MessageInput'
import { useLogoUrl } from '../../lib/logo'
import { ModelSelect, ThinkingSelect, DisplayMenu } from './ChatHeaderControls'
import { formatRelativeDate } from '../../lib/dateUtils'
import type { Session } from '../../lib/types'
import { agentIdFromSessionKey as sessionAgentId, isAutoKeyTitle, isCronSessionKey } from '../../lib/sessionName'

// A single row in the unified chat list — an opened conversation or a running-but-
// unopened gateway session, normalized to one shape.
interface ChatItem {
  key: string
  sessionKey?: string
  emoji: string
  name: string
  ts: number
  time?: string
  subtitle?: string
  running: boolean
  isActive: boolean
  heartbeat?: boolean
  cron?: boolean          // a cron-triggered run — grouped under "Scheduled"
  onOpen: () => void
  onDelete?: () => void
  onPopOut?: () => void
  onRename?: (name: string) => void
}

// `solo` runs ChatView inside a popped-out window: the sidebar is hidden and the view
// is locked to a single session (opened on mount), with a "return to main" control.
export function ChatView({ solo }: { solo?: string } = {}) {
  const { conversations, activeConvId, newConversation, selectConversation, deleteConversation, loadSessionMessages, watchSession, setModelOverride, setThinkingLevel } = useChatStore()
  const { agents, defaultId, fetch: fetchAgents } = useAgentsStore()
  const { sessions, customLabels, derivedNames, rename: renameSession, fetch: fetchSessions, delete: deleteSession } = useSessionsStore()
  const cronJobs = useCronsStore(s => s.jobs)
  const cronSessions = useCronsStore(s => s.cronSessions)
  const fetchCrons = useCronsStore(s => s.fetch)
  const logoUrl = useLogoUrl()
  const [search, setSearch] = useState('')
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active'>('all')
  // Recent chats are capped so reopening the app lands on the few you were last working
  // on, not a wall of every session; "Show older" reveals the rest on demand.
  const [showAllRecent, setShowAllRecent] = useState(false)
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

  // Load crons + subscribe to cron events so cron-triggered sessions can be
  // grouped under "Scheduled" and labelled by their job name.
  useEffect(() => { fetchCrons() }, [])

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
    // A controller that has yielded to a running sub-agent shows hasActiveRun:false /
    // status:'done' itself, but is still live — its worker is running. Treat that as
    // running so we keep watching it and re-attach on reconnect.
    if (s.hasActiveSubagentRun) return true
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

  const isHeartbeatSession = (s: Session) => s.isHeartbeat || s.key.includes(':heartbeat')

  // Idle sessions from the gateway (which survive an app restart, unlike the in-memory
  // conversation list) — the durable source for "the chats I was last working on".
  // Running ones are excluded (they surface under Active/Scheduled); heartbeats and
  // popped-out windows are noise; anything already opened as a conversation is deduped.
  const recentSessions = sessions.filter(s =>
    !isRunning(s) &&
    !conversationSessionKeys.has(s.key) &&
    !poppedOut.has(s.key) &&
    !isHeartbeatSession(s) &&
    // Finished cron runs are background jobs, not chats — they'd otherwise clutter the
    // list as plain rows labelled with the agent (e.g. "main"). They live in Crons.
    !isCronSessionKey(s.key) &&
    (s.updatedAt || s.startedAt)
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

  // "+ New" primary: start a chat with the default agent (or the first available).
  const startNewChat = () => {
    const a = agents.find(x => x.id === defaultId) ?? agents[0]
    if (a) newConversation(a.id, a.identity?.name ?? a.name ?? a.id)
  }

  const filtered = conversations.filter(c => {
    if (c.sessionKey && poppedOut.has(c.sessionKey)) return false   // shown in its own window
    const q = search.toLowerCase()
    return c.title.toLowerCase().includes(q) ||
      c.agentName.toLowerCase().includes(q) ||
      convDisplayName(c).toLowerCase().includes(q)
  })

  const activeConv = conversations.find(c => c.id === activeConvId)

  // ── Unified chat list ──────────────────────────────────────────────────────
  // One model instead of two zones: opened conversations + running-but-unopened
  // gateway sessions, normalized into ChatItems. Running items float to an "Active"
  // group at the top (a chat never "disappears" when you open it); everything else
  // falls into light date groups.
  const agentEmoji = (agentId: string) => agents.find(a => a.id === agentId)?.identity?.emoji ?? '🤖'
  const popOut = (key: string) => { window.api?.window?.popOutChat?.(key); selectConversation('') }

  // Deleting a chat must remove BOTH the in-memory conversation AND its durable gateway
  // session — otherwise the session survives and immediately re-surfaces as an idle
  // "recent" row (re-sorted by timestamp), which reads as "delete didn't work".
  const removeChat = (convId?: string, sessionKey?: string) => {
    if (sessionKey) deleteSession(sessionKey)
    if (convId) deleteConversation(convId)
  }

  const convItems: ChatItem[] = filtered.map(conv => {
    const sess = conv.sessionKey ? sessions.find(s => s.key === conv.sessionKey) : undefined
    const running = (!!sess && isRunning(sess)) || conv.messages.some(m => m.streaming)
    const at = conv.lastAt ?? conv.messages[0]?.createdAt
    return {
      key: conv.id,
      sessionKey: conv.sessionKey || undefined,
      emoji: agentEmoji(conv.agentId),
      name: convDisplayName(conv) || conv.title,
      ts: at ? new Date(at).getTime() : Date.now(),
      time: at ? formatRelativeDate(at) : undefined,
      subtitle: conv.lastMessage || (running ? 'Working…' : undefined),
      running,
      isActive: conv.id === activeConvId,
      onOpen: () => selectConversation(conv.id),
      onDelete: () => removeChat(conv.id, conv.sessionKey || undefined),
      onPopOut: conv.sessionKey ? () => popOut(conv.sessionKey!) : undefined,
      onRename: conv.sessionKey ? (name: string) => renameSession(conv.sessionKey!, name) : undefined,
    }
  })

  const sessionItems: ChatItem[] = activeSessions.map(s => ({
    key: `session:${s.key}`,
    sessionKey: s.key,
    emoji: agentEmoji(sessionAgentId(s.key)),
    name: sessionDisplayName(s),
    ts: s.updatedAt ?? s.startedAt ?? Date.now(),
    time: s.startedAt ? formatRelativeDate(new Date(s.startedAt).toISOString()) : undefined,
    subtitle: s.lastMessage || 'Working…',
    running: true,
    isActive: false,
    heartbeat: s.isHeartbeat || s.key.includes(':heartbeat'),
    onOpen: () => handleOpenSession(s),
    onPopOut: () => popOut(s.key),
    onRename: (name: string) => renameSession(s.key, name),
  }))

  // Tag any active item whose session is driven by a cron job, and relabel it with the
  // job name (a bare cron run otherwise shows up as the raw agent, e.g. "main").
  const activeCandidates = [...convItems.filter(i => i.running), ...sessionItems].map(i => {
    const job = i.sessionKey ? cronJobForSession(cronJobs, cronSessions, i.sessionKey) : undefined
    if (job) return { ...i, cron: true, name: job.name }
    // Fallback: a running cron session with no live job mapping is still a cron run —
    // group it under Scheduled rather than letting it show as a plain agent chat.
    if (i.sessionKey && isCronSessionKey(i.sessionKey)) return { ...i, cron: true }
    return i
  })
  const cronItems = activeCandidates.filter(i => i.cron).sort((a, b) => b.ts - a.ts)
  const activeItems = activeCandidates.filter(i => !i.cron).sort((a, b) => b.ts - a.ts)

  // Idle gateway sessions as chat rows (same shape as the running ones, minus the live
  // state), honouring the search box just like opened conversations do.
  const matchesSearch = (name: string) => name.toLowerCase().includes(search.toLowerCase())
  const recentSessionItems: ChatItem[] = recentSessions
    .filter(s => matchesSearch(sessionDisplayName(s)))
    .map(s => {
      const at = s.updatedAt ?? s.startedAt ?? 0
      return {
        key: `session:${s.key}`,
        sessionKey: s.key,
        emoji: agentEmoji(sessionAgentId(s.key)),
        name: sessionDisplayName(s),
        ts: at,
        time: at ? formatRelativeDate(new Date(at).toISOString()) : undefined,
        subtitle: s.lastMessage || undefined,
        running: false,
        isActive: false,
        onOpen: () => handleOpenSession(s),
        onDelete: () => removeChat(undefined, s.key),
        onPopOut: () => popOut(s.key),
        onRename: (name: string) => renameSession(s.key, name),
      }
    })

  // The recency stream: opened-but-idle conversations + idle gateway sessions, newest
  // first. Capped so a fresh launch shows the handful you were last on; the remainder is
  // one "Show older" click away rather than dumped into the list.
  const RECENT_LIMIT = 8
  const restItems = [...convItems.filter(i => !i.running), ...recentSessionItems]
    .sort((a, b) => b.ts - a.ts)
  const visibleRest = showAllRecent ? restItems : restItems.slice(0, RECENT_LIMIT)
  const hiddenRestCount = restItems.length - visibleRest.length

  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const dayLabel = (ts: number) => {
    const d = new Date(ts).toDateString()
    return d === today ? 'Today' : d === yesterday ? 'Yesterday' : 'Earlier'
  }
  const dateGroups = (['Today', 'Yesterday', 'Earlier'] as const)
    .map(label => ({ label, items: visibleRest.filter(i => dayLabel(i.ts) === label) }))
    .filter(g => g.items.length)

  const isEmpty = !activeItems.length && !cronItems.length && !dateGroups.length

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
            {/* Split button: primary starts a chat with the default agent; caret picks one. */}
            <div className="flex" style={{ borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <button
                onClick={startNewChat}
                title="New chat"
                className="flex items-center gap-1 text-xs font-medium"
                style={{ padding: '6px 8px', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', cursor: 'pointer' }}
              >
                <Plus size={13} /> New
              </button>
              <button
                onClick={() => setShowNewMenu(s => !s)}
                title="Start with a specific agent"
                style={{ padding: '6px 4px', background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderLeft: '1px solid color-mix(in srgb, var(--accent-fg) 25%, transparent)', cursor: 'pointer' }}
              >
                <ChevronDown size={12} />
              </button>
            </div>
            {showNewMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-50 py-1 min-w-max"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', maxHeight: 280, overflowY: 'auto' }}
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
                    <span>{agent.identity?.emoji ?? '🤖'}</span>
                    <span>{agent.identity?.name ?? agent.name ?? agent.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Segmented filter */}
        <div className="flex items-center gap-1 px-3 pb-2">
          <FilterTab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterTab label="Active" count={activeItems.length + cronItems.length} active={filter === 'active'} onClick={() => setFilter('active')} />
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <MessageSquare size={24} className="mb-2 opacity-30" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {search ? 'No chats found' : 'Start a chat with + New'}
              </p>
            </div>
          )}

          {/* Active: running chats (opened or not), pinned to the top and never moved. */}
          {activeItems.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <Radio size={11} className="animate-pulse-dot" style={{ color: 'var(--success)' }} />
                <p className="text-xs font-semibold" style={{ color: 'var(--success)' }}>Active</p>
                <span className="text-xs px-1.5 rounded-full ml-auto" style={{ background: 'color-mix(in srgb, var(--success) 20%, transparent)', color: 'var(--success)', fontSize: 10 }}>
                  {activeItems.length}
                </span>
              </div>
              {activeItems.map(item => <ChatRow key={item.key} item={item} />)}
            </div>
          )}

          {/* Scheduled: sessions currently being driven by a cron job, labelled by job name. */}
          {cronItems.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <Clock size={11} style={{ color: 'var(--text-secondary)' }} />
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Scheduled</p>
                <span className="text-xs px-1.5 rounded-full ml-auto" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 10 }}>
                  {cronItems.length}
                </span>
              </div>
              {cronItems.map(item => <ChatRow key={item.key} item={item} />)}
            </div>
          )}

          {filter === 'all' && dateGroups.map(group => (
            <div key={group.label} className="mb-2">
              <p className="text-xs font-medium px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                {group.label}
              </p>
              {group.items.map(item => <ChatRow key={item.key} item={item} />)}
            </div>
          ))}

          {filter === 'all' && (hiddenRestCount > 0 || showAllRecent) && (
            <button
              onClick={() => setShowAllRecent(v => !v)}
              className="w-full text-xs px-2 py-1.5 rounded"
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
            >
              {showAllRecent ? 'Show less' : `Show ${hiddenRestCount} older…`}
            </button>
          )}
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

function FilterTab({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium"
      style={{
        padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: 'none',
        background: active ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      {label}{count ? ` · ${count}` : ''}
    </button>
  )
}

function RowBtn({ children, title, danger, onClick }: { children: ReactNode; title: string; danger?: boolean; onClick: (e: ReactMouseEvent) => void }) {
  return (
    <button title={title} onClick={onClick} className="flex items-center justify-center rounded p-1"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: danger ? 'var(--danger)' : 'var(--text-secondary)' }}>
      {children}
    </button>
  )
}

// One row for any chat — opened conversation or a running gateway session. Running
// items show a live dot (in place of the agent emoji); hover reveals rename / pop-out /
// delete; the name is inline-editable.
function ChatRow({ item }: { item: ChatItem }) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.name)

  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== item.name) item.onRename?.(v) }

  return (
    <div
      className="relative flex flex-col px-2 py-2 rounded cursor-pointer"
      style={{
        background: item.isActive ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : hovered ? 'var(--bg-elevated)' : 'transparent',
        borderRadius: 'var(--radius)', marginBottom: 1,
      }}
      onClick={() => { if (!editing) item.onOpen() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-1.5">
        {item.running
          ? <span title="Running" className="animate-pulse-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
          : <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>{item.emoji}</span>}
        {editing ? (
          <input
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { setEditing(false); setDraft(item.name) } }}
            onBlur={commit}
            className="text-sm flex-1 font-medium"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '1px 5px', outline: 'none', minWidth: 0 }}
          />
        ) : (
          <p className="text-sm flex-1 truncate font-medium" style={{ color: item.isActive ? 'var(--accent)' : 'var(--text-primary)' }}>
            {item.name}
          </p>
        )}
        {item.cron && !editing && <Clock size={11} title="Scheduled run (cron job)" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />}
        {item.heartbeat && !editing && <Heart size={11} title="Heartbeat session" style={{ color: 'var(--accent)', opacity: 0.8, flexShrink: 0 }} />}
        {!editing && !hovered && item.time && <span className="text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>{item.time}</span>}
      </div>
      {item.subtitle && !editing && (
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)', marginLeft: 15 }}>{item.subtitle}</p>
      )}
      {hovered && !editing && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5"
          style={{ background: item.isActive ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'var(--bg-elevated)', borderRadius: 4 }}>
          {item.onRename && <RowBtn title="Rename" onClick={e => { e.stopPropagation(); setDraft(item.name); setEditing(true) }}><Pencil size={11} /></RowBtn>}
          {item.onPopOut && <RowBtn title="Pop out to a window" onClick={e => { e.stopPropagation(); item.onPopOut!() }}><ExternalLink size={11} /></RowBtn>}
          {item.onDelete && <RowBtn title="Delete" danger onClick={e => { e.stopPropagation(); item.onDelete!() }}><Trash2 size={11} /></RowBtn>}
        </div>
      )}
    </div>
  )
}

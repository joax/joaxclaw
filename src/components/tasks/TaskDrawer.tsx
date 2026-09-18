import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft, X, Maximize2, Minimize2, Loader2, Layers, Square, AlertTriangle, ChevronDown, Check, Copy, MessageSquare,
} from 'lucide-react'
import { SidePanel } from '../ui/SidePanel'
import { Pill } from '../ui/Pill'
import { FilterTab } from '../ui/FilterTab'
import { EmptyState } from '../ui/EmptyState'
import { Popover, MenuRow, MenuDivider, triggerStyle } from '../ui/Popover'
import { MarkdownContent } from '../chat/MarkdownContent'
import { UserMessage } from '../chat/UserMessage'
import { AssistantMessage } from '../chat/AssistantMessage'
import { TaskRow } from './TaskRow'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { useGatewaySupport } from '../../lib/useGatewaySupport'
import { toChatMessages } from '../../lib/chatHistory'
import { fmtElapsed } from '../../lib/scriptJobs'
import { agentIdFromSessionKey } from '../../lib/sessionName'
import {
  fromTask, fromScriptJob, listItems, taskAgents, stitchPages, deliveryLabel, resultText, taskChatKey,
  fmtDuration, canManageTasks, canRecover, type ListFilter, type TaskSummary, type BackgroundItem,
} from '../../lib/tasks'
import { useTasksStore } from '../../store/tasks'
import { useTaskHistoryStore } from '../../store/taskHistory'
import { useScriptJobsStore } from '../../store/scriptJobs'
import { useConnectionStore } from '../../store/connection'
import { useExtensionsStore } from '../../store/extensions'
import { useChatStore } from '../../store/chat'
import { useScriptJob } from '../chat/useScriptJob'

// The task drawer: one background task's output, prompt and result, with Stop, Retry
// delivery, Dismiss delivery, Copy result and Open its chat — or, in list mode, every
// agent's background work with filters. It takes the Files drawer's slot (the two close
// each other) and the Files drawer's layout: 380px beside the chat, full screen on a phone.

export function TaskDrawer({ onOpenChat }: { onOpenChat?: () => void }) {
  const drawer = useTasksStore(s => s.drawer)
  const closeDrawer = useTasksStore(s => s.closeDrawer)
  const narrow = useIsNarrow()
  // Focus goes back where it came from (the row that opened it) when the drawer closes.
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!drawer.open) return
    returnFocus.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      // Leave Escape to a menu or dialog that's open on top.
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"],[role="menu"]')) return
      closeDrawer()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const el = returnFocus.current
      if (el && document.contains(el)) el.focus()
    }
  }, [drawer.open, closeDrawer])

  // Loaded pages belong to the task on screen; drop them once it's gone from view.
  useEffect(() => { if (!drawer.open) useTaskHistoryStore.getState().reset() }, [drawer.open])

  if (!drawer.open) return null
  const list = drawer.mode === 'list'
  return (
    <SidePanel expanded={!narrow && !!drawer.expanded} label={list ? 'Background tasks' : 'Background task'}>
      {list ? <ListMode /> : drawer.jobId ? <JobDetail jobId={drawer.jobId} onOpenChat={onOpenChat} />
        : drawer.taskId ? <TaskDetail taskId={drawer.taskId} onOpenChat={onOpenChat} /> : null}
    </SidePanel>
  )
}

// ── Shared pieces ────────────────────────────────────────────────────────────

function Header({ title, subline, back }: { title: string; subline?: ReactNode; back?: () => void }) {
  const narrow = useIsNarrow()
  const expanded = useTasksStore(s => !!s.drawer.expanded)
  const { toggleExpanded, closeDrawer } = useTasksStore.getState()
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Focus the heading when the drawer opens or moves to another item, so a screen reader
  // announces it and Tab continues from the top of the drawer.
  useEffect(() => { headingRef.current?.focus() }, [title])
  const size = narrow ? 40 : 26
  return (
    <div
      className="flex items-start gap-1 px-2 py-2 shrink-0"
      style={{
        borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
        // Full screen on a phone (viewport-fit=cover), so clear the notch / status bar.
        ...(narrow ? { paddingTop: 'calc(env(safe-area-inset-top) + 8px)' } : {}),
      }}
    >
      {back && <IconBtn size={size} title="Back to all tasks" onClick={back}><ArrowLeft size={14} /></IconBtn>}
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, padding: back ? '3px 0 0' : '3px 0 0 6px' }}>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold truncate"
          style={{ margin: 0, color: 'var(--text-primary)', outline: 'none' }}
          title={title}
        >
          {title}
        </h2>
        {subline}
      </div>
      {!narrow && (
        <IconBtn size={size} title={expanded ? 'Restore' : 'Expand'} onClick={toggleExpanded}>
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </IconBtn>
      )}
      <IconBtn size={size} title="Close" onClick={closeDrawer}><X size={14} /></IconBtn>
    </div>
  )
}

function IconBtn({ size, title, onClick, children }: { size: number; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex items-center justify-center shrink-0"
      style={{ width: size, height: size, borderRadius: 5, border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
    >
      {children}
    </button>
  )
}

/** "(Running) · Subagent · 3m 12s", with status changes announced politely. */
function Subline({ item, now }: { item: BackgroundItem; now: number }) {
  const elapsed = item.startedAt !== undefined ? fmtDuration((item.endedAt ?? now) - item.startedAt)
    : item.job ? fmtElapsed(item.job.elapsedMs) : undefined
  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
      <span aria-live="polite"><Pill tone={item.state.tone}>{item.state.label}</Pill></span>
      <span className="truncate">{[item.kind.label, elapsed].filter(Boolean).join(' · ')}</span>
    </div>
  )
}

function MetaRows({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!shown.length) return null
  return (
    <dl className="grid text-xs px-4 py-3 shrink-0" style={{ gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0, borderBottom: '1px solid var(--border)' }}>
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--text-secondary)' }}>{k}</dt>
          <dd className="truncate" style={{ margin: 0, color: 'var(--text-primary)', minWidth: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Footer({ children }: { children: ReactNode }) {
  const narrow = useIsNarrow()
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2 shrink-0"
      style={{
        borderTop: '1px solid var(--border)', background: 'var(--bg-surface)',
        // Full screen on a phone: keep the buttons above the home indicator.
        ...(narrow ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' } : {}),
      }}
    >
      {children}
    </div>
  )
}

function FooterBtn({ onClick, disabled, title, label, danger, children }: {
  onClick: () => void; disabled?: boolean; title?: string; label?: string; danger?: boolean; children: ReactNode
}) {
  const narrow = useIsNarrow()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="inline-flex items-center gap-1.5 text-xs"
      style={{
        padding: narrow ? '0 12px' : '4px 10px', minHeight: narrow ? 40 : undefined, fontWeight: 500,
        borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)',
        color: danger ? 'var(--danger)' : 'var(--text-primary)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

function CopyResult({ text }: { text?: string }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <FooterBtn onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
      {copied ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy result'}
    </FooterBtn>
  )
}

function useOpenChat(onOpenChat?: () => void) {
  const narrow = useIsNarrow()
  return async (key: string) => {
    const agent = agentIdFromSessionKey(key)
    const chat = useChatStore.getState()
    const convId = await chat.loadSessionMessages(key, agent, agent)
    if (convId) chat.selectConversation(convId)
    onOpenChat?.()
    // On a phone the drawer covers the chat, so get out of the way.
    if (narrow) useTasksStore.getState().closeDrawer()
  }
}

/** Ticks every second while `active`, for elapsed times. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

const Centered = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
    {children}
  </div>
)

// ── One gateway task ─────────────────────────────────────────────────────────

type Tab = 'output' | 'prompt' | 'result'

function TaskDetail({ taskId, onOpenChat }: { taskId: string; onOpenChat?: () => void }) {
  const task = useTasksStore(s => s.byId[taskId])
  const gone = useTasksStore(s => !!s.gone[taskId])
  const fromList = useTasksStore(s => !!s.drawer.fromList)
  const pending = useTasksStore(s => s.pending[`task:${taskId}`])
  const error = useTasksStore(s => s.actionError[`task:${taskId}`])
  const { openList, stop, retry, dismiss } = useTasksStore.getState()
  const connected = useConnectionStore(s => s.status === 'connected')
  const canWrite = useConnectionStore(s => canManageTasks(s.grantedScopes))
  const history = useGatewaySupport({ methods: ['tasks.history'] }).supported
  const canCancel = useGatewaySupport({ methods: ['tasks.cancel'] }).supported
  const canRetry = useGatewaySupport({ methods: ['tasks.retry'] }).supported
  const canDismiss = useGatewaySupport({ methods: ['tasks.dismiss'] }).supported
  const openChat = useOpenChat(onOpenChat)
  const connectionSeq = useConnectionStore(s => s.connectionSeq)
  const [tab, setTab] = useState<Tab>(history ? 'output' : 'result')
  useEffect(() => { setTab(history ? 'output' : 'result') }, [taskId, history])
  // Opened from a push before the app had connected: read the task once it has.
  useEffect(() => {
    if (connected && !useTasksStore.getState().byId[taskId]?.prompt) void useTasksStore.getState().loadTask(taskId)
  }, [taskId, connected, connectionSeq])

  const item = task ? fromTask(task) : undefined
  const now = useNow(!!item?.active)
  const back = fromList ? openList : undefined

  if (gone && !task) {
    return (
      <>
        <Header title="Background task" back={back} />
        <Centered><Layers size={20} style={{ opacity: 0.3 }} />This task is no longer available.</Centered>
      </>
    )
  }
  if (!task || !item) {
    return (
      <>
        <Header title="Background task" back={back} />
        <Centered><Loader2 size={16} className="animate-spin" />Loading…</Centered>
      </>
    )
  }

  const chatKey = taskChatKey(task)
  const offTitle = connected ? undefined : 'Reconnect to manage tasks'
  // Before 2026.9 there's no transcript to read, and before 2026.7 tasks carry no prompt or
  // result either (2026.6.5's summary has neither), so a tab is only offered when it has
  // something to show.
  const result = resultText(task)
  const tabs: Tab[] = history ? ['output', 'prompt', 'result']
    : [...(task.prompt ? ['prompt' as const] : []), ...(result ? ['result' as const] : [])]
  const shown: Tab | undefined = tabs.includes(tab) ? tab : tabs[0]
  const recoverable = canRecover(task) && canWrite
  const tools = task.toolUseCount !== undefined
    ? `${task.toolUseCount}${task.lastToolName ? ` · last ${task.lastToolName}` : ''}` : task.lastToolName

  return (
    <>
      <Header title={task.title} subline={<Subline item={item} now={now} />} back={back} />
      {gone && <p className="text-xs px-4 py-2 shrink-0" style={{ margin: 0, color: 'var(--text-secondary)' }}>This task is no longer available.</p>}
      <MetaRows rows={[
        ['Agent', task.agentId],
        ['Started', item.startedAt !== undefined ? new Date(item.startedAt).toLocaleTimeString() : undefined],
        ['Tools', tools],
        ['Changes', task.diffStat ? `${task.diffStat.files} ${task.diffStat.files === 1 ? 'file' : 'files'} · +${task.diffStat.added} −${task.diffStat.removed}` : undefined],
        ['Delivery', task.deliveryStatus ? deliveryLabel(task.deliveryStatus) : undefined],
      ]} />

      {tabs.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-2 shrink-0" role="group" aria-label="Show">
          {tabs.map(t => (
            <FilterTab key={t} label={t === 'output' ? 'Output' : t === 'prompt' ? 'Prompt' : 'Result'} active={shown === t} onClick={() => setTab(t)} />
          ))}
        </div>
      )}
      {!history && (
        <p className="text-xs px-4 shrink-0" style={{ margin: tabs.length ? '0 0 6px' : '10px 0 6px', color: 'var(--text-secondary)' }}>
          Live output needs OpenClaw 2026.9 or later.
        </p>
      )}

      <div className="flex flex-col flex-1 min-h-0">
        {shown === 'output' && history && <OutputTab task={task} />}
        {shown === 'prompt' && <TextTab text={task.prompt} empty="No prompt recorded." />}
        {shown === 'result' && <TextTab text={result} empty={item.active ? 'No result yet.' : 'No result recorded.'} />}
      </div>

      {!gone && (
        <>
          {recoverable && (canRetry || canDismiss) && (
            <p className="flex items-center gap-1 text-xs px-4 pt-2 shrink-0" style={{ margin: 0, color: 'var(--warning)', borderTop: '1px solid var(--border)' }}>
              <AlertTriangle size={11} aria-hidden /> Retrying may post the result twice.
            </p>
          )}
          {error && <p role="alert" className="text-xs px-4 pt-2 shrink-0" style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
          <Footer>
            {chatKey && (
              <FooterBtn onClick={() => void openChat(chatKey)}><MessageSquare size={12} /> Open its chat</FooterBtn>
            )}
            <CopyResult text={result} />
            <span style={{ flex: 1 }} />
            {recoverable && canRetry && (
              <FooterBtn onClick={() => void retry(task.id)} disabled={!connected || !!pending} title={offTitle} label={`Retry delivery for ${task.title}`}>
                {pending === 'retry' && <Loader2 size={11} className="animate-spin" />} Retry delivery
              </FooterBtn>
            )}
            {recoverable && canDismiss && (
              <FooterBtn onClick={() => void dismiss(task.id)} disabled={!connected || !!pending} title={offTitle} label={`Dismiss delivery for ${task.title}`}>
                {pending === 'dismiss' && <Loader2 size={11} className="animate-spin" />} Dismiss delivery
              </FooterBtn>
            )}
            {item.active && canWrite && canCancel && (
              <FooterBtn onClick={() => void stop(item)} disabled={!connected || !!pending} title={offTitle} label={`Stop ${task.title}`} danger>
                <Square size={10} /> {pending === 'stop' ? 'Stopping…' : 'Stop'}
              </FooterBtn>
            )}
          </Footer>
        </>
      )}
    </>
  )
}

function TextTab({ text, empty }: { text?: string; empty: string }) {
  if (!text?.trim()) return <Centered>{empty}</Centered>
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 text-sm select-text">
      <MarkdownContent text={text} />
    </div>
  )
}

const pluginIdFor = (toolName: string) => useExtensionsStore.getState().toolNameMap.get(toolName)

function OutputTab({ task }: { task: TaskSummary }) {
  const { status, pages, nextCursor, loadingEarlier, error, taskId } = useTaskHistoryStore()
  const { load, loadEarlier, refreshHead } = useTaskHistoryStore.getState()
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const running = task.status === 'queued' || task.status === 'running'

  useEffect(() => {
    if (task.hasTranscript && taskId !== task.id) void load(task.id)
  }, [task.id, task.hasTranscript, taskId, load])

  // While it runs, each change to the task (a `task` event) re-reads the newest page.
  useEffect(() => {
    if (running && taskId === task.id) refreshHead()
  }, [task.updatedAt, running, taskId, task.id, refreshHead])

  const messages = useMemo(
    () => (taskId === task.id ? toChatMessages(stitchPages(pages), task.childSessionKey ?? task.sessionKey ?? task.id, pluginIdFor) : []),
    [pages, taskId, task.id, task.childSessionKey, task.sessionKey],
  )
  const rawCount = pages.reduce((n, p) => n + p.length, 0)

  // Follow new output only while already at the bottom, as the thread does.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length, pages])

  const summary = task.terminalSummary ?? task.progressSummary
  const noTranscript = (
    <Centered>
      This task didn&apos;t keep its output.
      {summary && <span style={{ color: 'var(--text-primary)' }}>{summary}</span>}
    </Centered>
  )

  if (!task.hasTranscript || (taskId === task.id && status === 'noTranscript')) return noTranscript
  if (taskId === task.id && status === 'gone') return <Centered>This task is no longer available.</Centered>
  if (taskId !== task.id || status === 'loading' || status === 'idle') {
    return <Centered><Loader2 size={16} className="animate-spin" />Loading output…</Centered>
  }
  if (status === 'error') {
    return (
      <Centered>
        <span style={{ color: 'var(--danger)' }}>{error}</span>
        <FooterBtn onClick={() => void load(task.id)}>Try again</FooterBtn>
      </Centered>
    )
  }
  if (!messages.length) return rawCount > 0 ? noTranscript : <Centered>No output yet.</Centered>

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 select-text"
      onScroll={e => {
        const el = e.currentTarget
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {nextCursor && (
        <div className="flex justify-center py-2">
          <FooterBtn onClick={() => void loadEarlier()} disabled={loadingEarlier}>
            {loadingEarlier ? <Loader2 size={11} className="animate-spin" /> : <ChevronDown size={11} style={{ transform: 'rotate(180deg)' }} />}
            Load earlier
          </FooterBtn>
        </div>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--danger)', margin: '4px 0' }}>{error}</p>}
      {messages.map(m => (m.role === 'user'
        ? <UserMessage key={m.id} message={m} readOnly />
        : <AssistantMessage key={m.id} message={m} showTools showReasoning={false} readOnly />))}
    </div>
  )
}

// ── One script job ───────────────────────────────────────────────────────────

function JobDetail({ jobId, onOpenChat }: { jobId: string; onOpenChat?: () => void }) {
  const listed = useScriptJobsStore(s => s.jobs[jobId])
  const expiredAt = useScriptJobsStore(s => s.expired[jobId])
  const { job: live, expired: liveExpired } = useScriptJob(jobId)
  const fromList = useTasksStore(s => !!s.drawer.fromList)
  const pending = useTasksStore(s => s.pending[`script:${jobId}`])
  const error = useTasksStore(s => s.actionError[`script:${jobId}`])
  const { openList, stop } = useTasksStore.getState()
  const connected = useConnectionStore(s => s.status === 'connected')
  const canWrite = useConnectionStore(s => canManageTasks(s.grantedScopes))
  const openChat = useOpenChat(onOpenChat)
  const preRef = useRef<HTMLPreElement>(null)

  // jobs.get has the output; the list doesn't. Whichever we have, the newest wins.
  const job = live ?? listed
  const expired = liveExpired || expiredAt !== undefined
  const item = job ? fromScriptJob(job, { expired, expiredAt }) : undefined
  const now = useNow(!!item?.active)
  const back = fromList ? openList : undefined

  useEffect(() => {
    const el = preRef.current
    if (el && item?.active) el.scrollTop = el.scrollHeight
  }, [live?.output, item?.active])

  if (!job || !item) {
    return (
      <>
        <Header title="Script" back={back} />
        {liveExpired
          ? <Centered><Layers size={20} style={{ opacity: 0.3 }} />This task is no longer available.</Centered>
          : <Centered><Loader2 size={16} className="animate-spin" />Loading…</Centered>}
      </>
    )
  }

  return (
    <>
      <Header title={job.command || 'Script'} subline={<Subline item={item} now={now} />} back={back} />
      <MetaRows rows={[
        ['Command', <code key="c" className="font-mono">{job.command}</code>],
        ['Working dir', job.cwd ? <code key="d" className="font-mono">{job.cwd}</code> : undefined],
        ['Exit code', job.done && job.exitCode !== null ? String(job.exitCode) : undefined],
      ]} />
      <p className="text-xs font-medium px-4 py-2 shrink-0" style={{ margin: 0, color: 'var(--text-secondary)' }}>Output</p>
      <pre
        ref={preRef}
        className="flex-1 min-h-0 select-text"
        style={{
          margin: '0 12px 12px', padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5, overflowY: 'auto',
          background: 'var(--bg-primary)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        }}
      >
        {live?.outputTruncated ? '…(earlier output truncated)\n' : ''}
        {live?.output || (item.active ? '(waiting for output…)' : live ? '(no output)' : "This task didn't keep its output.")}
      </pre>
      {error && <p role="alert" className="text-xs px-4 pb-2 shrink-0" style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
      <Footer>
        {job.sessionKey && (
          <FooterBtn onClick={() => void openChat(job.sessionKey!)}><MessageSquare size={12} /> Open its chat</FooterBtn>
        )}
        <span style={{ flex: 1 }} />
        {item.active && canWrite && (
          <FooterBtn onClick={() => void stop(item)} disabled={!connected || !!pending} title={connected ? undefined : 'Reconnect to manage tasks'} label={`Stop ${item.title}`} danger>
            <Square size={10} /> {pending === 'stop' ? 'Stopping…' : 'Stop'}
          </FooterBtn>
        )}
      </Footer>
    </>
  )
}

// ── List mode ────────────────────────────────────────────────────────────────

const FILTERS: { id: ListFilter; label: string }[] = [
  { id: 'running', label: 'Running' },
  { id: 'needsYou', label: 'Needs you' },
  { id: 'failed', label: 'Failed' },
  { id: 'all', label: 'All' },
]

function ListMode() {
  const narrow = useIsNarrow()
  const byId = useTasksStore(s => s.byId)
  const loaded = useTasksStore(s => s.loaded)
  const error = useTasksStore(s => s.error)
  const recentCursor = useTasksStore(s => s.recentCursor)
  const loadingMore = useTasksStore(s => s.loadingMore)
  const { openDrawer, openJob, loadGlobal, loadMore } = useTasksStore.getState()
  const jobs = useScriptJobsStore(s => s.jobs)
  const expired = useScriptJobsStore(s => s.expired)
  const supported = useGatewaySupport({ methods: ['tasks.list'] }).supported
  const [filter, setFilter] = useState<ListFilter>('all')
  const [agentId, setAgentId] = useState<string | undefined>()
  const [agentMenu, setAgentMenu] = useState(false)

  useEffect(() => {
    const store = useTasksStore.getState()
    if (!store.loaded) void store.loadGlobal()
    const unwatch = store.watch()
    const release = useScriptJobsStore.getState().acquire()
    return () => { unwatch(); release() }
  }, [])

  const tasks = useMemo(() => Object.values(byId), [byId])
  const scriptItems = useMemo(
    () => Object.values(jobs).map(j => fromScriptJob(j, { expired: j.id in expired, expiredAt: expired[j.id] })),
    [jobs, expired],
  )
  const items = useMemo(() => listItems({ tasks, jobs: scriptItems, filter, agentId }), [tasks, scriptItems, filter, agentId])
  const counts = useMemo(() => ({
    running: listItems({ tasks, jobs: scriptItems, filter: 'running' }).length,
    needsYou: listItems({ tasks, jobs: scriptItems, filter: 'needsYou' }).length,
  }), [tasks, scriptItems])
  const agents = useMemo(() => taskAgents(tasks), [tasks])
  const now = useNow(items.some(i => i.active))

  return (
    <>
      <Header title="Background tasks" />
      <div className="flex items-center gap-1 px-3 py-2 shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        {FILTERS.map(f => (
          <FilterTab
            key={f.id}
            label={f.label}
            count={f.id === 'running' ? counts.running : f.id === 'needsYou' ? counts.needsYou : undefined}
            active={filter === f.id}
            onClick={() => setFilter(f.id)}
          />
        ))}
        <span style={{ flex: 1 }} />
        {agents.length > 0 && (
          <Popover
            open={agentMenu}
            onOpenChange={setAgentMenu}
            title="Agent"
            sheetOnNarrow
            trigger={p => (
              <button type="button" {...p} style={{ ...triggerStyle, fontSize: 12 }}>
                {agentId ?? 'All agents'} <ChevronDown size={11} />
              </button>
            )}
          >
            <MenuRow selected={!agentId} onClick={() => { setAgentId(undefined); setAgentMenu(false) }}>All agents</MenuRow>
            <MenuDivider />
            {agents.map(a => (
              <MenuRow key={a} selected={agentId === a} onClick={() => { setAgentId(a); setAgentMenu(false) }}>{a}</MenuRow>
            ))}
          </Popover>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs px-4 py-2 shrink-0" style={{ color: 'var(--danger)' }}>
          <span style={{ flex: 1 }}>Couldn&apos;t load background tasks: {error}</span>
          <FooterBtn onClick={() => void loadGlobal()}>Retry</FooterBtn>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3" style={narrow ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' } : undefined}>
        {supported && !loaded && !error && !scriptItems.length ? (
          <Centered><Loader2 size={16} className="animate-spin" />Loading…</Centered>
        ) : items.length === 0 ? (
          <EmptyState icon={Layers} label="No background work." hint="Tasks your agents start appear here." compact />
        ) : (
          items.map(item => (
            <TaskRow
              stacked
              key={item.key}
              item={item}
              now={now}
              onOpen={item.source === 'task' ? () => openDrawer(item.id) : () => openJob(item.id)}
            />
          ))
        )}
        {recentCursor && (filter === 'all' || filter === 'failed') && (
          <div className="flex justify-center py-3">
            <FooterBtn onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore && <Loader2 size={11} className="animate-spin" />} Load more
            </FooterBtn>
          </div>
        )}
      </div>
    </>
  )
}

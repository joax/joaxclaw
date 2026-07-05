import { useEffect, useState, useRef, useCallback } from 'react'
import { Bot, MessageSquare, Wrench, Loader2, BookOpen, FolderOpen, X } from 'lucide-react'
import { useAgentsStore } from '../../store/agents'
import { useObsidianVaults } from '../../store/memory'
import { useSessionsStore } from '../../store/sessions'
import { useCronsStore } from '../../store/crons'
import { gatewayClient } from '../../lib/gateway'
import { AgentEditor } from './AgentEditor'
import { ModelIcon } from '../ui/ModelIcon'
import type { Agent, Session } from '../../lib/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_PLUGIN_IDS = new Set([
  'ollama', 'openai', 'anthropic', 'google', 'mistral', 'deepseek', 'groq',
  'xai', 'venice', 'openrouter', 'microsoft', 'together', 'vllm', 'sglang',
  'lmstudio', 'huggingface', 'nvidia', 'perplexity', 'byteplus', 'chutes',
  'kilocode', 'qianfan', 'xiaomi', 'tencent', 'volcengine', 'vercel-ai-gateway',
  'opencode', 'opencode-go', 'vydra', 'zai', 'synthetic', 'stepfun', 'arcee',
  'alibaba', 'amazon-bedrock', 'bonjour', 'copilot-proxy', 'deepgram', 'fal',
  'microsoft-foundry', 'moonshot', 'minimax', 'kimi', 'firewors',
])

const CHANNEL_PLUGIN_IDS = new Set(['whatsapp', 'slack', 'qqbot', 'discord', 'telegram'])

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChannelInfo {
  id: string
  accounts: { id: string; name?: string }[]
  boundAgentIds: string[]
}

interface OverviewData {
  channels: ChannelInfo[]
  tools: string[]
  skills: string[]
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadOverviewData(): Promise<OverviewData> {
  const snap = await gatewayClient.request<{ config?: Record<string, unknown> }>('config.get', {})
  const cfg = (snap.config ?? {}) as Record<string, unknown>

  // Channels + bindings
  const channelsCfg = (cfg.channels ?? {}) as Record<string, {
    enabled?: boolean
    accounts?: Record<string, { name?: string }>
  }>
  const bindings = (cfg.bindings ?? []) as { agentId: string; match: { channel: string } }[]

  const channels: ChannelInfo[] = []
  for (const [id, ch] of Object.entries(channelsCfg)) {
    if (ch.enabled === false) continue
    const accounts = Object.entries(ch.accounts ?? {}).map(([accId, acc]) => ({ id: accId, name: acc.name }))
    const boundAgentIds = bindings.filter(b => b.match.channel === id).map(b => b.agentId)
    channels.push({ id, accounts, boundAgentIds })
  }

  // Enabled tool plugins (not providers, not channels)
  const pluginsCfg = (cfg.plugins ?? {}) as { entries?: Record<string, { enabled?: boolean }> }
  const tools: string[] = []
  for (const [id, entry] of Object.entries(pluginsCfg.entries ?? {})) {
    if (entry.enabled === false) continue
    if (PROVIDER_PLUGIN_IDS.has(id) || CHANNEL_PLUGIN_IDS.has(id)) continue
    tools.push(id)
  }

  // Enabled skills (obsidian is handled by the right panel via useObsidianStore)
  const skillsCfg = (cfg.skills ?? {}) as { entries?: Record<string, { enabled?: boolean }> }
  const skills: string[] = []
  for (const [id, entry] of Object.entries(skillsCfg.entries ?? {})) {
    if (entry.enabled === false) continue
    if (id === 'obsidian') continue
    skills.push(id)
  }

  return { channels, tools, skills }
}

// ── SVG connectors ────────────────────────────────────────────────────────────

function VertConn({ area }: { area: string }) {
  return (
    <div style={{ gridArea: area, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <svg width="14" height="44" viewBox="0 0 14 44" style={{ overflow: 'visible' }}>
        <line x1="7" y1="2" x2="7" y2="30" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4 3" />
        <polygon points="2,28 12,28 7,40" fill="var(--border)" />
      </svg>
    </div>
  )
}

function HorizConn({ area }: { area: string }) {
  return (
    <div style={{ gridArea: area, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="44" height="14" viewBox="0 0 44 14" style={{ overflow: 'visible' }}>
        <line x1="2" y1="7" x2="30" y2="7" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4 3" />
        <polygon points="28,2 28,12 40,7" fill="var(--border)" />
      </svg>
    </div>
  )
}

// ── Block wrapper ─────────────────────────────────────────────────────────────

function Block({ title, icon, children, area, accent }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  area?: string
  accent?: boolean
}) {
  return (
    <div style={{
      ...(area ? { gridArea: area } : {}),
      background: 'var(--bg-surface)',
      border: `1px solid ${accent ? 'color-mix(in srgb, var(--accent) 40%, var(--border))' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        padding: '6px 12px', flexShrink: 0,
        borderBottom: `1px solid ${accent ? 'color-mix(in srgb, var(--accent) 20%, var(--border))' : 'var(--border)'}`,
        background: accent ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-elevated))' : 'var(--bg-elevated)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ color: accent ? 'var(--accent)' : 'var(--text-secondary)' }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: accent ? 'var(--accent)' : 'var(--text-secondary)' }}>
          {title}
        </span>
      </div>
      <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Empty({ text }: { text: string }) {
  return <span style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.55 }}>{text}</span>
}

function Tag({ label, mono }: { label: string; mono?: boolean }) {
  return (
    <span style={{
      fontSize: 11, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap',
      border: '1px solid var(--border)', background: 'var(--bg-elevated)',
      color: 'var(--text-secondary)',
      fontFamily: mono ? 'monospace' : 'inherit',
    }}>
      {label}
    </span>
  )
}

function shortPath(ws: string): string {
  const parts = ws.split('/').filter(Boolean)
  return parts.length <= 2 ? ws : `…/${parts.slice(-2).join('/')}`
}

// ── Running indicator ─────────────────────────────────────────────────────────

function RunningDot() {
  return (
    <span style={{ position: 'absolute', top: 7, right: 7 }}>
      <span style={{
        display: 'block', width: 8, height: 8, borderRadius: '50%',
        background: 'var(--success, #22c55e)',
        boxShadow: '0 0 0 0 color-mix(in srgb, var(--success, #22c55e) 60%, transparent)',
        animation: 'pulse-ring 1.5s ease-out infinite',
      }} />
    </span>
  )
}

// ── Entry agent card (top block) ─────────────────────────────────────────────

function EntryAgentCard({ agent, onClick, running }: { agent: Agent; onClick?: () => void; running?: boolean }) {
  const name = agent.identity?.name ?? agent.name ?? agent.id
  const model = agent.model?.primary ?? agent.agentRuntime?.id ?? ''
  const emoji = agent.identity?.emoji

  const slash = model.indexOf('/')
  const provider = slash !== -1 ? model.slice(0, slash) : null
  const modelId  = slash !== -1 ? model.slice(slash + 1) : model

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        padding: '10px 14px', borderRadius: 8, minWidth: 130,
        background: running
          ? 'color-mix(in srgb, var(--success, #22c55e) 8%, var(--bg-elevated))'
          : 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))',
        border: running
          ? '1px solid color-mix(in srgb, var(--success, #22c55e) 40%, var(--border))'
          : '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = running ? 'color-mix(in srgb, var(--success, #22c55e) 14%, var(--bg-elevated))' : 'color-mix(in srgb, var(--accent) 14%, var(--bg-elevated))' }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = running ? 'color-mix(in srgb, var(--success, #22c55e) 8%, var(--bg-elevated))' : 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))' }}
    >
      {running && <RunningDot />}
      <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji ?? '🤖'}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>{name}</span>
      {model && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          {provider && (
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
              {provider}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <ModelIcon model={model} size={9} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {modelId}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Subagent row (center block, with inline workspace) ────────────────────────

function AgentRow({ agent, onClick, running }: { agent: Agent; onClick?: () => void; running?: boolean }) {
  const name = agent.identity?.name ?? agent.name ?? agent.id
  const model = agent.model?.primary ?? agent.agentRuntime?.id ?? ''
  const emoji = agent.identity?.emoji

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 9px',
        borderRadius: 6,
        background: running
          ? 'color-mix(in srgb, var(--success, #22c55e) 6%, var(--bg-elevated))'
          : 'color-mix(in srgb, var(--bg-primary) 60%, var(--bg-elevated))',
        border: running
          ? '1px solid color-mix(in srgb, var(--success, #22c55e) 35%, var(--border))'
          : '1px solid var(--border)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = running ? 'color-mix(in srgb, var(--success, #22c55e) 12%, var(--bg-elevated))' : 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = running ? 'color-mix(in srgb, var(--success, #22c55e) 6%, var(--bg-elevated))' : 'color-mix(in srgb, var(--bg-primary) 60%, var(--bg-elevated))' }}
    >
      {running && <RunningDot />}
      <span style={{ fontSize: 16, lineHeight: 1.25, flexShrink: 0, marginTop: 1 }}>
        {emoji ?? '🤖'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {name}
        </span>
        {model && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
            <ModelIcon model={model} size={9} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {model}
            </span>
          </div>
        )}
        {agent.workspace && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
            <FolderOpen size={9} style={{ color: 'var(--text-secondary)', opacity: 0.55, flexShrink: 0 }} />
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shortPath(agent.workspace)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Channel card ─────────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: '#25d366', slack: '#4a154b', discord: '#5865f2',
  telegram: '#0088cc', qqbot: '#12b7f5',
}

function ChannelCard({ channel, boundAgent, onClick }: { channel: ChannelInfo; boundAgent?: Agent; onClick?: () => void }) {
  const color = CHANNEL_COLORS[channel.id] ?? 'var(--accent)'
  const model = boundAgent?.model?.primary ?? boundAgent?.agentRuntime?.id ?? ''
  const slash = model.indexOf('/')
  const provider = slash !== -1 ? model.slice(0, slash) : null
  const modelId  = slash !== -1 ? model.slice(slash + 1) : model

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '10px 14px', borderRadius: 8, minWidth: 110,
        background: `color-mix(in srgb, ${color} 10%, var(--bg-elevated))`,
        border: `1px solid color-mix(in srgb, ${color} 35%, var(--border))`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = `color-mix(in srgb, ${color} 18%, var(--bg-elevated))` }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = `color-mix(in srgb, ${color} 10%, var(--bg-elevated))` }}
    >
      <MessageSquare size={20} style={{ color }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{channel.id}</span>
      {channel.accounts.map(acc => (
        <span key={acc.id} style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center' }}>
          {acc.name ?? acc.id}
        </span>
      ))}
      {model && (
        <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, borderTop: `1px solid color-mix(in srgb, ${color} 20%, var(--border))`, paddingTop: 4, width: '100%' }}>
          {provider && (
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
              {provider}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <ModelIcon model={model} size={9} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {modelId}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── TopSection: channels → SVG lines → entry agents ───────────────────────────

interface SvgLine { key: string; path: string }

function TopSection({ channels, entryAgents, activeAgentIds, onSelectAgent, onSelectChannel }: {
  channels: ChannelInfo[]
  entryAgents: Agent[]
  activeAgentIds: Set<string>
  onSelectAgent: (a: Agent) => void
  onSelectChannel: (c: ChannelInfo) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chRefs  = useRef(new Map<string, HTMLDivElement>())
  const agRefs  = useRef(new Map<string, HTMLDivElement>())
  const [lines, setLines] = useState<SvgLine[]>([])
  const [svgW, setSvgW]   = useState(0)
  const [svgH, setSvgH]   = useState(0)

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()
    setSvgW(cr.width)
    setSvgH(cr.height)
    const result: SvgLine[] = []
    for (const ch of channels) {
      const agentId = ch.boundAgentIds[0]
      if (!agentId) continue
      const chEl = chRefs.current.get(ch.id)
      const agEl = agRefs.current.get(agentId)
      if (!chEl || !agEl) continue
      const chR = chEl.getBoundingClientRect()
      const agR = agEl.getBoundingClientRect()
      const x1 = chR.left + chR.width  / 2 - cr.left
      const y1 = chR.bottom - cr.top
      const x2 = agR.left + agR.width  / 2 - cr.left
      const y2 = agR.top  - cr.top
      const cy = (y1 + y2) / 2
      result.push({ key: `${ch.id}->${agentId}`, path: `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}` })
    }
    setLines(result)
  }, [channels])

  useEffect(() => {
    requestAnimationFrame(measure)
    const ro = new ResizeObserver(() => requestAnimationFrame(measure))
    const el = containerRef.current
    if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div ref={containerRef} style={{ gridArea: 'top', display: 'flex', flexDirection: 'column', gap: 44, position: 'relative' }}>
      <svg
        width={svgW} height={svgH}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}
      >
        <defs>
          <marker id="ch-arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,1 L7,3.5 L0,6 Z" fill="var(--border)" />
          </marker>
        </defs>
        {lines.map(l => (
          <path key={l.key} d={l.path} fill="none" stroke="var(--border)"
            strokeWidth="1.5" strokeDasharray="5 3" markerEnd="url(#ch-arr)" opacity={0.7} />
        ))}
      </svg>

      <Block title="Communication Channels" icon={<MessageSquare size={12} />}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {channels.length === 0
            ? <Empty text="No channels enabled" />
            : channels.map(ch => {
              const boundAgent = entryAgents.find(a => ch.boundAgentIds.includes(a.id))
              return (
                <div key={ch.id} ref={el => { if (el) chRefs.current.set(ch.id, el); else chRefs.current.delete(ch.id) }}>
                  <ChannelCard channel={ch} boundAgent={boundAgent} onClick={() => onSelectChannel(ch)} />
                </div>
              )
            })
          }
        </div>
      </Block>

      <Block title="Entry Agents" icon={<Bot size={12} />}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {entryAgents.length === 0
            ? <Empty text="No entry agents — all agents are sub-agents" />
            : entryAgents.map(a => (
                <div key={a.id} ref={el => { if (el) agRefs.current.set(a.id, el); else agRefs.current.delete(a.id) }}>
                  <EntryAgentCard agent={a} running={activeAgentIds.has(a.id)} onClick={() => onSelectAgent(a)} />
                </div>
              ))
          }
        </div>
      </Block>
    </div>
  )
}

// ── Channel panel (sidebar) ───────────────────────────────────────────────────

function ChannelPanel({ channel, boundAgent, onClose }: {
  channel: ChannelInfo
  boundAgent?: Agent
  onClose: () => void
}) {
  const color = CHANNEL_COLORS[channel.id] ?? 'var(--accent)'
  const model = boundAgent?.model?.primary ?? boundAgent?.agentRuntime?.id ?? ''

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose} />
      <div className="fixed right-0 bottom-0 z-50 flex flex-col" style={{ top: 36, width: 340, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <MessageSquare size={16} style={{ color }} />
            <h2 className="font-semibold text-sm capitalize" style={{ color: 'var(--text-primary)' }}>{channel.id}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-5 p-5 overflow-y-auto flex-1 text-sm">
          {channel.accounts.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Accounts</p>
              <div className="flex flex-col gap-1.5">
                {channel.accounts.map(acc => (
                  <div key={acc.id} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{acc.name ?? acc.id}</span>
                    {acc.name && <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{acc.id}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {boundAgent && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Bound Agent</p>
              <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 18 }}>{boundAgent.identity?.emoji ?? '🤖'}</span>
                <div className="flex flex-col">
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{boundAgent.identity?.name ?? boundAgent.name ?? boundAgent.id}</span>
                  {model && <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{model}</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

function sessionAgentId(key: string): string {
  const atIdx = key.indexOf('@')
  return atIdx > 0 ? key.slice(0, atIdx) : key
}

const TERMINAL_STATUSES = new Set(['idle', 'done', 'failed', 'killed', 'timeout'])

function sessionIsRunning(s: Session): boolean {
  if (s.status && TERMINAL_STATUSES.has(s.status)) return false
  if (s.hasActiveRun === false) return false
  if (s.status === 'running') return true
  return s.hasActiveRun ?? false
}

// Probe the gateway for background/isolated session data.
// Tries tasks.list and sessions.list with broader params — logs raw results
// so we can see the actual gateway response shapes.
async function probeBackgroundTasks(): Promise<string[]> {
  const agentIds: string[] = []

  // ── Probe 1: tasks.list ────────────────────────────────────────────────────
  try {
    const res = await gatewayClient.request<unknown>('tasks.list', {})
    console.log('[AgentSystemView] tasks.list response:', res)
    const tasks = (res as Record<string, unknown>)?.tasks
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        const task = t as Record<string, unknown>
        const isRunning = task.status === 'running' || task.status === 'active'
        const aid = task.agentId ?? task.agent_id
        if (isRunning && typeof aid === 'string') agentIds.push(aid)
      }
    }
  } catch (e) {
    console.log('[AgentSystemView] tasks.list not available:', e)
  }

  // ── Probe 2: sessions.list with includeAll / includeIsolated ───────────────
  try {
    const res = await gatewayClient.request<{ sessions?: unknown[] }>('sessions.list', {
      includeAll: true,
      includeIsolated: true,
      status: 'running',
    })
    console.log('[AgentSystemView] sessions.list(includeAll) response:', res)
    for (const s of res.sessions ?? []) {
      const sess = s as Record<string, unknown>
      const key = typeof sess.key === 'string' ? sess.key : ''
      const isRunning = sess.status === 'running' || sess.hasActiveRun === true
      if (isRunning && key) {
        const aid = typeof sess.agentId === 'string' ? sess.agentId : sessionAgentId(key)
        if (aid) agentIds.push(aid)
      }
    }
  } catch (e) {
    console.log('[AgentSystemView] sessions.list(includeAll) failed:', e)
  }

  return agentIds
}

export function AgentSystemView() {
  const { agents, fetch: fetchAgents } = useAgentsStore()
  const vaults = useObsidianVaults()
  const sessions = useSessionsStore(s => s.sessions)
  const fetchSessions = useSessionsStore(s => s.fetch)
  const cronJobs = useCronsStore(s => s.jobs)
  const cronRunningNow = useCronsStore(s => s.runningNow)
  const fetchCronJobs = useCronsStore(s => s.fetch)
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | null>(null)
  const [backgroundAgentIds, setBackgroundAgentIds] = useState<string[]>([])

  useEffect(() => {
    fetchAgents()
    fetchCronJobs()
    setLoading(true)
    loadOverviewData()
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
    fetchSessions()
    const t = setInterval(fetchSessions, 10_000)

    // Probe gateway for background sessions; repeat on same cadence
    const runProbe = () => probeBackgroundTasks().then(ids => setBackgroundAgentIds(ids))
    runProbe()
    const tp = setInterval(runProbe, 10_000)

    return () => { clearInterval(t); clearInterval(tp) }
  }, [])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-secondary)' }}>
        <Loader2 size={16} className="animate-spin" /> Loading system overview…
      </div>
    )
  }

  const allSubIds = new Set(agents.flatMap(a => a.allowedSubAgents ?? []))
  const entryAgents = agents.filter(a => !allSubIds.has(a.id))
  const subAgents   = agents.filter(a =>  allSubIds.has(a.id))

  // Active agent IDs from open sessions (user chats)
  const activeAgentIds = new Set(sessions.filter(sessionIsRunning).map(s => sessionAgentId(s.key)))

  // Agents running via cron-triggered isolated sessions
  // Mirror CronsView: runningAtMs (scheduled) OR runningNow (manually triggered)
  for (const job of cronJobs) {
    if ((job.state?.runningAtMs || cronRunningNow.has(job.id)) && job.agentId) {
      activeAgentIds.add(job.agentId)
    }
  }

  // Agents found via gateway background task probes (tasks.list / sessions.list+includeAll)
  for (const aid of backgroundAgentIds) activeAgentIds.add(aid)

  return (
    <>
    <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, auto) 44px minmax(260px, 1fr) 44px minmax(160px, auto)',
        gridTemplateRows: 'auto 44px auto',
        gridTemplateAreas: `
          "top     top     top     top      top"
          ".       .       vconn1  .        ."
          "tools   hconn1  agents  hconn2   obsidian"
        `,
        gap: '0 0',
      }}>

        {/* ── TOP: Channels → Entry Agents ── */}
        <TopSection
          channels={data?.channels ?? []}
          entryAgents={entryAgents}
          activeAgentIds={activeAgentIds}
          onSelectAgent={setSelectedAgent}
          onSelectChannel={setSelectedChannel}
        />

        <VertConn area="vconn1" />

        {/* ── CENTER: Sub-agents ── */}
        <Block area="agents" title="Sub-Agents" icon={<Bot size={12} />} accent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {subAgents.length === 0
              ? <Empty text={agents.length === 0 ? 'No agents configured' : 'No sub-agent relationships configured'} />
              : subAgents.map(a => <AgentRow key={a.id} agent={a} running={activeAgentIds.has(a.id)} onClick={() => setSelectedAgent(a)} />)
            }
          </div>
        </Block>

        <HorizConn area="hconn1" />

        {/* ── LEFT: Tools & skills ── */}
        <Block area="tools" title="Tools & Skills" icon={<Wrench size={12} />}>
          {!data || (data.tools.length === 0 && data.skills.length === 0)
            ? <Empty text="No tools enabled" />
            : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.tools.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Plugins</span>
                      {data.tools.map(t => <Tag key={t} label={t} mono />)}
                    </div>
                  )}
                  {data.skills.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Skills</span>
                      {data.skills.map(s => <Tag key={s} label={s} mono />)}
                    </div>
                  )}
                </div>
              )
          }
        </Block>

        <HorizConn area="hconn2" />

        {/* ── RIGHT: Obsidian vaults ── */}
        <Block area="obsidian" title="Obsidian Vaults" icon={<BookOpen size={12} />}>
          {vaults.length === 0
            ? <Empty text="No vaults configured" />
            : vaults.map(v => (
                <div key={v.url} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 9px', borderRadius: 6, background: '#8b5cf611', border: '1px solid #8b5cf633' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#a78bfa' }}>{v.name}</span>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.7 }}>
                    {v.mode === 'local' ? 'local' : 'remote'} · {v.url}
                  </span>
                </div>
              ))
          }
        </Block>

      </div>
    </div>

    {selectedAgent && (
      <AgentEditor agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    )}
    {selectedChannel && !selectedAgent && (
      <ChannelPanel
        channel={selectedChannel}
        boundAgent={agents.find(a => selectedChannel.boundAgentIds.includes(a.id))}
        onClose={() => setSelectedChannel(null)}
      />
    )}
    </>
  )
}

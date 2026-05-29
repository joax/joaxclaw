import { useEffect, useState } from 'react'
import { Bot, MessageSquare, Wrench, Loader2, BookOpen, FolderOpen } from 'lucide-react'
import { useAgentsStore } from '../../store/agents'
import { useObsidianStore } from '../../store/obsidian'
import { gatewayClient } from '../../lib/gateway'
import type { Agent } from '../../lib/types'

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
  area: string
  accent?: boolean
}) {
  return (
    <div style={{
      gridArea: area,
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

// ── Entry agent card (top block) ─────────────────────────────────────────────

function EntryAgentCard({ agent }: { agent: Agent }) {
  const name = agent.identity?.name ?? agent.name ?? agent.id
  const model = agent.model?.primary ?? agent.agentRuntime?.id ?? ''
  const emoji = agent.identity?.emoji

  const slash = model.indexOf('/')
  const provider = slash !== -1 ? model.slice(0, slash) : null
  const modelId  = slash !== -1 ? model.slice(slash + 1) : model

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      padding: '10px 14px', borderRadius: 8, minWidth: 130,
      background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))',
      border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))',
    }}>
      <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji ?? '🤖'}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>{name}</span>
      {model && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          {provider && (
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
              {provider}
            </span>
          )}
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {modelId}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Subagent row (center block, with inline workspace) ────────────────────────

function AgentRow({ agent }: { agent: Agent }) {
  const name = agent.identity?.name ?? agent.name ?? agent.id
  const model = agent.model?.primary ?? agent.agentRuntime?.id ?? ''
  const emoji = agent.identity?.emoji

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 9px',
      borderRadius: 6,
      background: 'color-mix(in srgb, var(--bg-primary) 60%, var(--bg-elevated))',
      border: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 16, lineHeight: 1.25, flexShrink: 0, marginTop: 1 }}>
        {emoji ?? '🤖'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {name}
        </span>
        {model && (
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {model}
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

// ── Main view ─────────────────────────────────────────────────────────────────

export function AgentSystemView() {
  const { agents } = useAgentsStore()
  const { vaults, loadConfig } = useObsidianStore()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadConfig()
    setLoading(true)
    loadOverviewData()
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
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

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, auto) 44px minmax(280px, auto) 44px minmax(180px, auto)',
        gridTemplateRows: 'auto 44px auto 44px auto',
        gridTemplateAreas: `
          "models  models  models  models  models"
          ".       .       vconn1  .       ."
          "chans   hconn1  agents  hconn2  obsidian"
          ".       .       vconn2  .       ."
          "tools   tools   tools   tools   tools"
        `,
      }}>

        {/* ── TOP: Entry agents ── */}
        <Block area="models" title="Entry Agents" icon={<Bot size={12} />}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {entryAgents.length === 0
              ? <Empty text="No entry agents — all agents are sub-agents" />
              : entryAgents.map(a => <EntryAgentCard key={a.id} agent={a} />)
            }
          </div>
        </Block>

        <VertConn area="vconn1" />

        {/* ── LEFT: Channels ── */}
        <Block area="chans" title="Channels" icon={<MessageSquare size={12} />}>
          {!data || data.channels.length === 0
            ? <Empty text="No channels enabled" />
            : data.channels.map(ch => {
                const boundAgent = ch.boundAgentIds[0]
                  ? agents.find(a => a.id === ch.boundAgentIds[0])
                  : null
                const boundName = boundAgent
                  ? (boundAgent.identity?.name ?? boundAgent.name ?? boundAgent.id)
                  : null
                return (
                  <div key={ch.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{ch.id}</span>
                    </div>
                    {ch.accounts.map(acc => (
                      <div key={acc.id} style={{ paddingLeft: 13, fontSize: 11, color: 'var(--text-secondary)' }}>
                        {acc.name ? `"${acc.name}"` : acc.id}
                      </div>
                    ))}
                    {boundName && (
                      <div style={{ paddingLeft: 13, fontSize: 10, fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.6 }}>
                        → {boundName}
                      </div>
                    )}
                  </div>
                )
              })
          }
        </Block>

        <HorizConn area="hconn1" />

        {/* ── CENTER: Sub-agents ── */}
        <Block area="agents" title="Sub-Agents" icon={<Bot size={12} />} accent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {subAgents.length === 0
              ? <Empty text={agents.length === 0 ? 'No agents configured' : 'No sub-agent relationships configured'} />
              : subAgents.map(a => <AgentRow key={a.id} agent={a} />)
            }
          </div>
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

        <VertConn area="vconn2" />

        {/* ── BOTTOM: Tools & skills ── */}
        <Block area="tools" title="Tools & Skills" icon={<Wrench size={12} />}>
          {!data || (data.tools.length === 0 && data.skills.length === 0)
            ? <Empty text="No tools enabled" />
            : (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {data.tools.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Plugins</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {data.tools.map(t => <Tag key={t} label={t} mono />)}
                      </div>
                    </div>
                  )}
                  {data.skills.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Skills</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {data.skills.map(s => <Tag key={s} label={s} mono />)}
                      </div>
                    </div>
                  )}
                </div>
              )
          }
        </Block>

      </div>
    </div>
  )
}

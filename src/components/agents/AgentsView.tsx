import { useEffect, useState } from 'react'
import { Bot, RefreshCw, GitFork, Network, Plus, X, AlertCircle, MessageSquare, FolderOpen, ChevronRight } from 'lucide-react'
import { useAgentsStore, normalizeAgentId } from '../../store/agents'
import { useChatStore } from '../../store/chat'
import type { Agent } from '../../lib/types'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { ModelIcon } from '../ui/ModelIcon'
import { ModelPicker } from '../ui/ModelPicker'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { AgentEditor } from './AgentEditor'
import { AgentGraph } from './AgentGraph'
import { AgentSystemView } from './AgentSystemView'

interface Props { onOpenChat: () => void }

function agentDisplayName(agent: Agent): string {
  return agent.identity?.name ?? agent.name ?? agent.id
}

export function AgentsView({ onOpenChat }: Props) {
  const { agents, defaultId, loading, error, fetch, update, remove } = useAgentsStore()
  const { newConversation } = useChatStore()
  const narrow = useIsNarrow()
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [creating, setCreating] = useState(false)
  const [viewMode, setViewMode] = useState<'graph' | 'overview'>('graph')

  useEffect(() => { fetch() }, [])

  const handleChat = (agent: Agent) => {
    newConversation(agent.id, agentDisplayName(agent))
    onOpenChat()
  }

  const handleConnect = (fromId: string, toId: string) => {
    const from = agents.find(a => a.id === fromId)
    if (!from) return
    const current = from.allowedSubAgents ?? []
    if (current.includes(toId)) return
    update(fromId, { allowedSubAgents: [...current, toId] })
  }

  const handleDisconnect = (fromId: string, toId: string) => {
    const from = agents.find(a => a.id === fromId)
    if (!from) return
    update(fromId, { allowedSubAgents: (from.allowedSubAgents ?? []).filter(id => id !== toId) })
  }

  const hasRelationships = agents.some(a => (a.allowedSubAgents ?? []).length > 0)

  return (
    <div className="flex flex-1 flex-col min-h-0" style={{ padding: narrow ? 16 : 24 }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Agents</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {loading ? 'Loading…' : `${agents.length} agent${agents.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {agents.length > 0 && !narrow && (
            <div
              className="flex items-center rounded overflow-hidden"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}
            >
              <button
                onClick={() => setViewMode('graph')}
                title="Hierarchy view"
                style={{
                  padding: '5px 9px',
                  background: viewMode === 'graph' ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'transparent',
                  color: viewMode === 'graph' ? 'var(--accent)' : 'var(--text-secondary)',
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.15s',
                }}
              >
                <GitFork size={14} />
              </button>
              <button
                onClick={() => setViewMode('overview')}
                title="System overview"
                style={{
                  padding: '5px 9px',
                  background: viewMode === 'overview' ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'transparent',
                  color: viewMode === 'overview' ? 'var(--accent)' : 'var(--text-secondary)',
                  border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.15s',
                }}
              >
                <Network size={14} />
              </button>
            </div>
          )}
          <Btn variant="outline" size="sm" icon={<RefreshCw size={13} />} onClick={fetch} loading={loading}>
            Refresh
          </Btn>
          <Btn size="sm" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
            New Agent
          </Btn>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded text-sm" style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {!loading && agents.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3" style={{ color: 'var(--text-secondary)' }}>
          <Bot size={40} style={{ opacity: 0.3 }} />
          <p className="text-sm">No agents found on gateway</p>
          <Btn size="sm" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
            Create your first agent
          </Btn>
        </div>
      )}

      {/* Mobile: the pan/zoom graph and the wide overview grid can't be dragged in a
          phone viewport, so replace both with a scrollable agent list. */}
      {agents.length > 0 && narrow && (
        <MobileAgentsList
          agents={agents}
          defaultId={defaultId}
          onEdit={setEditingAgent}
          onChat={handleChat}
        />
      )}

      {agents.length > 0 && !narrow && viewMode === 'graph' && (
        <div className="flex flex-1 flex-col min-h-0">
          <AgentGraph
            agents={agents}
            defaultId={defaultId}
            onChat={a => { handleChat(a) }}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onEdit={setEditingAgent}
            onDelete={a => remove(a.id)}
          />
          {!hasRelationships && (
            <p className="text-xs text-center pb-3" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
              No sub-agent relationships configured — edges will appear when agents have <code>allowedSubAgents</code>
            </p>
          )}
        </div>
      )}

      {!narrow && viewMode === 'overview' && <AgentSystemView />}

      {editingAgent && (
        <AgentEditor agent={editingAgent} onClose={() => setEditingAgent(null)} />
      )}

      {creating && (
        <CreateAgentModal
          onClose={() => setCreating(false)}
          onCreated={id => {
            setCreating(false)
            const created = useAgentsStore.getState().agents.find(a => a.id === id)
            if (created) setEditingAgent(created)
          }}
        />
      )}
    </div>
  )
}

// ── Mobile agent list ─────────────────────────────────────────────────────────
// Replaces the draggable graph on phones: a plain scrollable list. Each card taps
// through to the full-screen editor; a Chat button starts a conversation. Sub-agent
// relationships (the graph's edges) are shown inline as "Delegates to" chips.
function MobileAgentsList({ agents, defaultId, onEdit, onChat }: {
  agents: Agent[]
  defaultId: string | null | undefined
  onEdit: (a: Agent) => void
  onChat: (a: Agent) => void
}) {
  const byId = new Map(agents.map(a => [a.id, a]))
  return (
    <div className="flex-1 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 10, WebkitOverflowScrolling: 'touch' }}>
      {agents.map(a => {
        const name  = agentDisplayName(a)
        const model = a.model?.primary ?? a.agentRuntime?.id ?? ''
        const subs  = a.allowedSubAgents ?? []
        const isDefault = a.id === defaultId
        return (
          <div
            key={a.id}
            onClick={() => onEdit(a)}
            style={{
              display: 'flex', flexDirection: 'column', gap: 8, padding: 14,
              borderRadius: 'var(--radius)', background: 'var(--bg-surface)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{a.identity?.emoji ?? '🤖'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</span>
                  {isDefault && (
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)', flexShrink: 0 }}>Default</span>
                  )}
                </div>
                {model && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <ModelIcon model={model} size={11} />
                    <span className="truncate" style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{model}</span>
                  </div>
                )}
                {a.workspace && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <FolderOpen size={11} style={{ color: 'var(--text-secondary)', opacity: 0.6, flexShrink: 0 }} />
                    <span className="truncate" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', opacity: 0.75 }}>{a.workspace}</span>
                  </div>
                )}
              </div>
              <ChevronRight size={18} style={{ color: 'var(--text-secondary)', opacity: 0.4, flexShrink: 0, marginTop: 2 }} />
            </div>

            {subs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, paddingTop: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', opacity: 0.7 }}>Delegates to</span>
                {subs.map(id => (
                  <span key={id} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    {byId.get(id)?.identity?.emoji ?? ''} {byId.get(id) ? agentDisplayName(byId.get(id)!) : id}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={e => { e.stopPropagation(); onChat(a) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, flex: 1, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                <MessageSquare size={15} /> Chat
              </button>
              <button
                onClick={e => { e.stopPropagation(); onEdit(a) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, flex: 1, borderRadius: 'var(--radius)', border: 'none', background: 'var(--accent)', color: 'var(--accent-fg, #fff)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Configure
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Create agent modal ────────────────────────────────────────────────────────

function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (agentId: string) => void }) {
  const { create, defaultWorkspaceRoot } = useAgentsStore()
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [model, setModel] = useState('')
  const [emoji, setEmoji] = useState('')
  const [wsRoot, setWsRoot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { defaultWorkspaceRoot().then(setWsRoot) }, [])

  // The path the gateway will use if Workspace is left blank.
  const computedDefault = wsRoot && name.trim()
    ? `${wsRoot.replace(/\/+$/, '')}/${normalizeAgentId(name)}`
    : ''

  // Workspace is optional as long as we can resolve a default for them.
  const canSubmit = name.trim().length > 0 && (workspace.trim().length > 0 || computedDefault.length > 0) && !saving

  async function handleCreate() {
    if (!canSubmit) return
    setSaving(true); setErr(null)
    try {
      const agentId = await create({ name, workspace, model, emoji })
      onCreated(agentId)
    } catch (e) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 z-50 flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)', width: 440, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>New Agent</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <CreateField label="Name" hint="The agent id is derived from this name.">
            <Input value={name} onChange={setName} placeholder="e.g. Research Assistant" autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && workspace.trim()) handleCreate() }} />
          </CreateField>

          <CreateField
            label="Workspace (optional)"
            hint={
              workspace.trim()
                ? "Filesystem path for the agent's working directory."
                : computedDefault
                  ? `Leave blank to use the default: ${computedDefault}`
                  : wsRoot === null
                    ? 'No gateway default configured — a workspace path is required.'
                    : "Filesystem path for the agent's working directory."
            }
          >
            <Input value={workspace} onChange={setWorkspace}
              placeholder={computedDefault || 'e.g. ~/agents/research'}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleCreate() }} />
          </CreateField>

          <CreateField label="Model (optional)">
            <ModelPicker value={model} onChange={setModel} placeholder="default model" />
          </CreateField>

          <CreateField label="Emoji (optional)">
            <Input value={emoji} onChange={setEmoji} placeholder="🤖" />
          </CreateField>

          {err && (
            <div className="flex items-start gap-2 px-3 py-2 rounded text-xs" style={{
              background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              border: '1px solid var(--danger)', color: 'var(--danger)'
            }}>
              <AlertCircle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <Btn variant="outline" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" onClick={handleCreate} loading={saving} disabled={!canSubmit}>Create agent</Btn>
        </div>
      </div>
    </>
  )
}

function CreateField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label.toUpperCase()}
      </label>
      {children}
      {hint && <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{hint}</p>}
    </div>
  )
}

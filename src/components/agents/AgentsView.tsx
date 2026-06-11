import { useEffect, useState } from 'react'
import { Bot, RefreshCw, GitFork, Network, Plus, X, AlertCircle } from 'lucide-react'
import { useAgentsStore, normalizeAgentId } from '../../store/agents'
import { useChatStore } from '../../store/chat'
import type { Agent } from '../../lib/types'
import { Btn } from '../ui/Btn'
import { Input } from '../ui/Input'
import { ModelPicker } from '../ui/ModelPicker'
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
    <div className="flex flex-1 flex-col min-h-0 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Agents</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {loading ? 'Loading…' : `${agents.length} agent${agents.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {agents.length > 0 && (
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

      {agents.length > 0 && viewMode === 'graph' && (
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

      {viewMode === 'overview' && <AgentSystemView />}

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
          transform: 'translate(-50%, -50%)', width: 440,
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

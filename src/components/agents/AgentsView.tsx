import { useEffect, useState } from 'react'
import { Bot, RefreshCw, GitFork, Network } from 'lucide-react'
import { useAgentsStore } from '../../store/agents'
import { useChatStore } from '../../store/chat'
import type { Agent } from '../../lib/types'
import { Btn } from '../ui/Btn'
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
    </div>
  )
}

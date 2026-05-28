import { useEffect, useState } from 'react'
import { MessageSquare, Trash2, Bot, RefreshCw, Settings2 } from 'lucide-react'
import { useAgentsStore } from '../../store/agents'
import { useChatStore } from '../../store/chat'
import type { Agent } from '../../lib/types'
import { Btn } from '../ui/Btn'
import { AgentEditor } from './AgentEditor'

interface Props { onOpenChat: () => void }

function agentDisplayName(agent: Agent): string {
  return agent.identity?.name ?? agent.name ?? agent.id
}

function agentEmoji(agent: Agent): string | null {
  return agent.identity?.emoji ?? null
}

function agentModel(agent: Agent): string {
  return agent.model?.primary ?? agent.agentRuntime?.id ?? '—'
}

export function AgentsView({ onOpenChat }: Props) {
  const { agents, defaultId, loading, error, fetch, remove } = useAgentsStore()
  const { newConversation } = useChatStore()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)

  useEffect(() => { fetch() }, [])

  const handleChat = (agent: Agent) => {
    newConversation(agent.id, agentDisplayName(agent))
    onOpenChat()
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Agents</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {loading ? 'Loading…' : `${agents.length} agent${agents.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Btn variant="outline" size="sm" icon={<RefreshCw size={13} />} onClick={fetch} loading={loading}>
          Refresh
        </Btn>
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

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {agents.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isDefault={agent.id === defaultId}
            onChat={() => handleChat(agent)}
            onEdit={() => setEditingAgent(agent)}
            onDelete={() => setConfirmDelete(agent.id)}
            confirmingDelete={confirmDelete === agent.id}
            onConfirmDelete={() => { remove(agent.id); setConfirmDelete(null) }}
            onCancelDelete={() => setConfirmDelete(null)}
          />
        ))}
      </div>

      {editingAgent && (
        <AgentEditor agent={editingAgent} onClose={() => setEditingAgent(null)} />
      )}
    </div>
  )
}

function AgentCard({ agent, isDefault, onChat, onEdit, onDelete, confirmingDelete, onConfirmDelete, onCancelDelete }: {
  agent: Agent
  isDefault: boolean
  onChat: () => void
  onEdit: () => void
  onDelete: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const emoji = agentEmoji(agent)
  const name = agentDisplayName(agent)
  const model = agentModel(agent)

  return (
    <div
      className="flex flex-col p-4 transition-all"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        transition: 'border-color 0.15s'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className="flex items-center justify-center text-xl shrink-0"
          style={{
            width: 44, height: 44,
            borderRadius: 'var(--radius)',
            background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))',
            fontSize: emoji ? 22 : undefined
          }}
        >
          {emoji ?? <Bot size={20} style={{ color: 'var(--accent)' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{name}</p>
            {isDefault && (
              <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', fontSize: 10 }}>
                default
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{model}</p>
          {agent.workspace && (
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{agent.workspace}</p>
          )}
        </div>
      </div>

      <div className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-mono" style={{ opacity: 0.6 }}>{agent.id}</span>
      </div>

      {confirmingDelete ? (
        <div className="flex gap-2">
          <Btn size="sm" variant="danger" onClick={onConfirmDelete} style={{ flex: 1 }}>Delete</Btn>
          <Btn size="sm" variant="outline" onClick={onCancelDelete} style={{ flex: 1 }}>Cancel</Btn>
        </div>
      ) : (
        <div className="flex gap-2">
          <Btn size="sm" icon={<MessageSquare size={12} />} onClick={onChat} style={{ flex: 1 }}>Chat</Btn>
          <Btn size="sm" variant="outline" icon={<Settings2 size={12} />} onClick={onEdit} />
          <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={onDelete} style={{ color: 'var(--danger)' }} />
        </div>
      )}
    </div>
  )
}

import { describe, it, expect, vi, beforeEach } from 'vitest'

// sendViaAgent's options (Meetings) without changing what its older callers get: the
// default agent, a chat titled from the prompt, and navigation.

vi.mock('../../store/agents', async () => {
  const { create } = await import('zustand')
  return { useAgentsStore: create(() => ({ agents: [{ id: 'main', name: 'Main' }, { id: 'ops', name: 'Ops' }], defaultId: 'main' })) }
})
vi.mock('../../store/chat', async () => {
  const { create } = await import('zustand')
  type Conv = { id: string; agentId: string; title: string }
  const store = create<{ conversations: Conv[]; activeConvId: string | null; sent: string[]
    newConversation: (agentId: string, name: string) => string; sendMessage: (id: string, text: string) => Promise<void> }>((set) => ({
    conversations: [], activeConvId: 'current', sent: [],
    newConversation(agentId) {
      const id = `c${Math.random().toString(36).slice(2, 7)}`
      set(s => ({ conversations: [{ id, agentId, title: 'New chat' }, ...s.conversations], activeConvId: id }))
      return id
    },
    async sendMessage(id, text) {
      set(s => ({ sent: [...s.sent, text], conversations: s.conversations.map(c => (c.id === id ? { ...c, title: text.slice(0, 40) } : c)) }))
    },
  }))
  return { useChatStore: store }
})

const { sendViaAgent } = await import('../agentPrompt')
const { useChatStore } = await import('../../store/chat')
type ChatState = { conversations: { id: string; agentId: string; title: string }[]; activeConvId: string | null }
const chat = () => useChatStore.getState() as unknown as ChatState

beforeEach(() => { useChatStore.setState({ conversations: [], activeConvId: 'current' } as never) })

describe('sendViaAgent', () => {
  it('keeps the old behaviour: default agent, navigates, becomes the open chat', () => {
    const open = vi.fn()
    const id = sendViaAgent('Run this', open)
    expect(open).toHaveBeenCalledOnce()
    expect(chat().activeConvId).toBe(id)
    expect(chat().conversations[0]).toMatchObject({ id, agentId: 'main' })
  })
  it('navigate:false leaves the open chat alone and never calls onOpenChat', () => {
    const open = vi.fn()
    const id = sendViaAgent('Summarize', open, { navigate: false })
    expect(open).not.toHaveBeenCalled()
    expect(chat().activeConvId).toBe('current')
    expect(chat().conversations[0].id).toBe(id)
  })
  it('uses the chosen agent and title', () => {
    const id = sendViaAgent('Join', undefined, { agentId: 'ops', title: 'Notes: Zoom · 10:00', navigate: false })
    expect(chat().conversations.find(c => c.id === id)).toMatchObject({ agentId: 'ops', title: 'Notes: Zoom · 10:00' })
  })
})

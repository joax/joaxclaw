import { useAgentsStore } from '../store/agents'
import { useChatStore } from '../store/chat'

// Open a chat with an agent and send it a prompt, returning the new conversation id.
// Shared by the "via agent" flows (joaxclaw-fs plugin install, gateway update, meeting
// joins) that ask an agent on the gateway host to do something.
// `onOpenChat` is fired after the conversation exists so the caller can navigate to the
// chat view to watch the agent work.
//
// Options, all optional so the older call sites are unchanged:
// - `agentId`: which agent; the default agent otherwise.
// - `title`: the chat's title, instead of one made from the prompt.
// - `navigate: false`: start it in the background. `onOpenChat` isn't called, and the
//   chat you had open stays the open one.
export function sendViaAgent(
  prompt: string,
  onOpenChat?: () => void,
  opts: { agentId?: string; title?: string; navigate?: boolean } = {},
): string {
  const { agents, defaultId } = useAgentsStore.getState()
  const agent = agents.find(a => a.id === (opts.agentId ?? defaultId)) ?? (opts.agentId ? undefined : agents[0])
  const agentId = agent?.id ?? opts.agentId ?? defaultId ?? 'main'
  const agentName = agent?.name ?? agent?.identity?.name ?? agentId
  const chat = useChatStore.getState()
  const previous = chat.activeConvId
  const convId = chat.newConversation(agentId, agentName)
  const background = opts.navigate === false
  if (background) useChatStore.setState({ activeConvId: previous })
  else onOpenChat?.()
  chat.sendMessage(convId, prompt).catch(() => {})
  // sendMessage titles a new chat from its first message, synchronously; override that.
  if (opts.title) {
    useChatStore.setState(s => ({ conversations: s.conversations.map(c => (c.id === convId ? { ...c, title: opts.title! } : c)) }))
  }
  return convId
}

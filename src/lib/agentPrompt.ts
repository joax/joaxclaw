import { useAgentsStore } from '../store/agents'
import { useChatStore } from '../store/chat'

// Open a chat with the default agent and send it a prompt, returning the new
// conversation id. Shared by the "via agent" flows (joaxclaw-fs plugin install,
// gateway update) that ask an agent on the gateway host to run a shell script.
// `onOpenChat` is fired after the conversation exists so the caller can navigate
// to the chat view to watch the agent work.
export function sendViaAgent(prompt: string, onOpenChat?: () => void): string {
  const { agents, defaultId } = useAgentsStore.getState()
  const agent = agents.find(a => a.id === defaultId) ?? agents[0]
  const agentId = agent?.id ?? defaultId ?? 'main'
  const agentName = agent?.name ?? agent?.identity?.name ?? agentId
  const chat = useChatStore.getState()
  const convId = chat.newConversation(agentId, agentName)
  onOpenChat?.()
  chat.sendMessage(convId, prompt).catch(() => {})
  return convId
}

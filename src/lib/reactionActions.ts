// Detecting a model's reaction issued through the gateway's channel `message`
// tool (`action: "react"`). The UI lifts these out of the raw tool card into a
// friendly "Reacted 👍" chip. Pure + dependency-free so it's easy to test.
//
// Note: the message id in such a call is a CHANNEL message id (e.g. a WhatsApp /
// Telegram timestamp id), not a JoaxClaw chat message — so this reflects the
// model's channel activity, not an in-chat reaction.

export interface ReactAction {
  emoji: string
  target?: string
}

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {}
  try {
    const v = JSON.parse(args)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Returns the reaction if `call` is a channel message-tool react, else null.
 * Matches any tool whose name mentions "message" with `action === "react"` and a
 * non-empty emoji.
 */
export function parseReactAction(name: string, args?: string): ReactAction | null {
  if (!/message/i.test(name)) return null
  const a = parseArgs(args)
  if (typeof a.action !== 'string' || a.action.toLowerCase() !== 'react') return null
  const emoji = typeof a.emoji === 'string' ? a.emoji.trim() : ''
  if (!emoji) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
  const target = str(a.target ?? a.to ?? a.channel ?? a.chat ?? a.chatId ?? a.conversation).trim()
  return { emoji, target: target || undefined }
}

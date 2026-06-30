// Shared helpers for turning an opaque gateway session key into a human name.
// Keys come in a few shapes:
//   "agent:<agentId>:<kind>:<uuid>"   e.g. agent:research-worker:subagent:a6d1…
//   "<agentId>@<uuid>"                legacy
//   "scope:…:name"

// Recover the agent id from a session key (the segment a human would recognise).
export function agentIdFromSessionKey(key: string): string {
  const parts = key.split(':')
  if (parts[0] === 'agent' && parts[1]) return parts[1]
  const at = key.indexOf('@')
  if (at > 0) return key.slice(0, at)
  return parts.length >= 2 ? parts[parts.length - 1] : key
}

// True when a stored conversation title is just an auto-derived rendering of the key
// (the raw key, or one of the old "agentId · uuid8" / "kind · uuid" parses) rather
// than a real agent name or a message — so callers can safely replace it.
export function isAutoKeyTitle(title: string, key: string): boolean {
  if (!title || title === key) return true
  const at = key.indexOf('@')
  if (at > 0 && title === `${key.slice(0, at)} · ${key.slice(at + 1, at + 9)}`) return true
  const parts = key.split(':').filter(Boolean)
  if (parts.length >= 2 && title === parts.slice(-2).join(' · ')) return true
  return false
}

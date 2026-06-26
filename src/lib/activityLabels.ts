// Plain-language activity labels for the chat "Basic" mode. Turns the technical
// stream (tool calls, reasoning, sub-session waits, prompt ingestion) into a calm,
// friendly "what's happening right now" line + a trail of completed steps — so a
// run-of-the-mill user sees "Searching the web…" instead of raw tool JSON.

import {
  Terminal, PenLine, FileText, FolderSearch, Globe, Plug, Users, Wrench,
  Brain, Sparkles, Hourglass, Image as ImageIcon, type LucideIcon,
} from 'lucide-react'
import type { ChatMessage, ToolCall } from './types'

export interface Activity { Icon: LucideIcon; label: string; whimsy?: boolean }

// Playful "thinking" verbs in the spirit of Claude Code's spinner words (the leaked
// "Tengu" set). Shown — and rotated — while the model is working with no specific
// tool, so a generic wait feels alive instead of a flat "Working…".
export const WHIMSY_VERBS: readonly string[] = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Baking', 'Booping', 'Brewing',
  'Calculating', 'Cerebrating', 'Channelling', 'Churning', 'Clauding', 'Coalescing',
  'Cogitating', 'Combobulating', 'Computing', 'Concocting', 'Conjuring', 'Considering',
  'Contemplating', 'Cooking', 'Crafting', 'Creating', 'Crunching', 'Deciphering',
  'Deliberating', 'Determining', 'Discombobulating', 'Divining', 'Doing', 'Elucidating',
  'Enchanting', 'Envisioning', 'Finagling', 'Flibbertigibbeting', 'Forging', 'Forming',
  'Frolicking', 'Generating', 'Germinating', 'Hatching', 'Herding', 'Honking',
  'Hustling', 'Ideating', 'Imagining', 'Incubating', 'Inferring', 'Jiving',
  'Manifesting', 'Marinating', 'Meandering', 'Moseying', 'Mulling', 'Mustering',
  'Musing', 'Noodling', 'Percolating', 'Perusing', 'Philosophising', 'Pondering',
  'Pontificating', 'Processing', 'Puttering', 'Puzzling', 'Reticulating', 'Ruminating',
  'Scheming', 'Schlepping', 'Shimmying', 'Shucking', 'Simmering', 'Smooshing',
  'Spelunking', 'Spinning', 'Stewing', 'Sussing', 'Synthesizing', 'Thinking',
  'Tinkering', 'Transmuting', 'Unfurling', 'Unravelling', 'Vibing', 'Wandering',
  'Whirring', 'Wibbling',
]

export function randomWhimsy(): string {
  return WHIMSY_VERBS[Math.floor(Math.random() * WHIMSY_VERBS.length)]
}

// A different verb than `prev`, so rotation never visibly repeats the same word.
export function nextWhimsy(prev: string): string {
  if (WHIMSY_VERBS.length < 2) return WHIMSY_VERBS[0] ?? ''
  let v = prev
  while (v === prev) v = randomWhimsy()
  return v
}

type Kind =
  | 'bash' | 'file-write' | 'file-read' | 'file-search'
  | 'web-search' | 'web-fetch' | 'gateway' | 'agent'
  | 'memory' | 'canvas' | 'image' | 'unknown'

// Classify a tool call. Prefers the owning plugin id (stable) and falls back to
// name heuristics that mirror detectKind() in AssistantMessage.
function kindOf(name: string, pluginId?: string): Kind {
  const n = name.toLowerCase()
  const p = (pluginId ?? '').toLowerCase()
  if (p.includes('memory')) return 'memory'
  if (p.includes('canvas')) return 'canvas'
  if (/image|video|music|imagen|dall|gen/.test(p)) return 'image'
  if (/browser|playwright|fetch/.test(p)) return 'web-fetch'

  if (/\bbash\b|shell|run_command|execute_command|run_bash|terminal|\bexec\b/.test(n)) return 'bash'
  if (/write_file|create_file|overwrite|str_replace|patch_file|edit_file|\bwrite\b|\bedit\b/.test(n)) return 'file-write'
  if (/read_file|view_file|cat_file|\bread\b|\bview\b|\bopen\b/.test(n)) return 'file-read'
  if (/search_files|find_files|\bgrep\b|\bfind\b|\bglob\b|list_files|ls_files/.test(n)) return 'file-search'
  if (/web_search|\bsearch\b(?!.*file)/.test(n)) return 'web-search'
  if (/web_fetch|http_request|\bfetch\b|\bbrowse\b|\bvisit\b|\burl\b/.test(n)) return 'web-fetch'
  if (/image|draw|render|diffus/.test(n)) return 'image'
  if (/gateway|config|openclaw/.test(n)) return 'gateway'
  if (/run_agent|spawn_session|sub.?agent|agent_call|\bteam\b|\bprocess\b|delegate/.test(n)) return 'agent'
  return 'unknown'
}

const LABELS: Record<Kind, { Icon: LucideIcon; now: string; past: string }> = {
  'bash':        { Icon: Terminal,     now: 'Running a command',         past: 'Ran a command' },
  'file-write':  { Icon: PenLine,      now: 'Writing files',             past: 'Updated files' },
  'file-read':   { Icon: FileText,     now: 'Reading files',             past: 'Read files' },
  'file-search': { Icon: FolderSearch, now: 'Looking through files',     past: 'Searched files' },
  'web-search':  { Icon: Globe,        now: 'Searching the web',         past: 'Searched the web' },
  'web-fetch':   { Icon: Globe,        now: 'Reading a web page',        past: 'Read a web page' },
  'memory':      { Icon: Brain,        now: 'Recalling context',         past: 'Recalled context' },
  'canvas':      { Icon: PenLine,      now: 'Working on a canvas',       past: 'Updated a canvas' },
  'image':       { Icon: ImageIcon,    now: 'Creating an image',         past: 'Created an image' },
  'gateway':     { Icon: Plug,         now: 'Updating settings',         past: 'Updated settings' },
  'agent':       { Icon: Users,        now: 'Working with a specialist', past: 'Worked with a specialist' },
  'unknown':     { Icon: Wrench,       now: 'Working on it',             past: 'Did some work' },
}

function prettyName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
}

export function toolActivity(call: ToolCall, when: 'now' | 'past'): Activity {
  const k = kindOf(call.name, call.pluginId)
  const l = LABELS[k]
  if (k === 'unknown') {
    return { Icon: l.Icon, label: when === 'now' ? `Working on it (${prettyName(call.name)})` : `Used ${prettyName(call.name)}` }
  }
  return { Icon: l.Icon, label: when === 'now' ? l.now : l.past }
}

// The single "what's happening right now" line, or null when the turn is idle.
// Priority: a running tool → sub-session → reasoning → prompt ingest → generic.
export function currentActivity(message: ChatMessage, promptProgress: number | null): Activity | null {
  const running = [...(message.toolCalls ?? [])].reverse().find(tc => tc.status === 'running')
  if (running) return toolActivity(running, 'now')
  if (message.waitingForSession) return { Icon: Users, label: 'Working with a specialist' }
  if (message.reasoningStreaming) return { Icon: Sparkles, label: 'Thinking', whimsy: true }
  if (promptProgress != null) return { Icon: Hourglass, label: 'Getting ready' }
  if (message.streaming && !message.content) return { Icon: Sparkles, label: 'Working on it', whimsy: true }
  return null
}

// Completed tool steps as a friendly trail, collapsing consecutive repeats with a count.
export function completedSteps(message: ChatMessage): Array<Activity & { count: number }> {
  const out: Array<Activity & { count: number }> = []
  for (const c of message.toolCalls ?? []) {
    if (c.status !== 'done' && c.status !== 'error') continue
    const a = toolActivity(c, 'past')
    const last = out[out.length - 1]
    if (last && last.label === a.label) last.count++
    else out.push({ ...a, count: 1 })
  }
  return out
}

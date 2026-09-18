import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

// The way round for an action this connection can't take itself: show the command to run
// on the gateway host, with a copy button. Used wherever an admin-only action is
// unavailable (design rule 5).

/** A copy icon that turns into a check for 1.2s once the value is on the clipboard. */
export function CopyButton({ value, title = 'Copy', copiedTitle = 'Copied', size = 12 }: {
  value: string
  title?: string
  copiedTitle?: string
  size?: number
}) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200) }}
      title={done ? copiedTitle : title}
      aria-label={done ? copiedTitle : title}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: done ? 'var(--success)' : 'var(--text-secondary)', padding: 2, display: 'inline-flex' }}
    >
      {done ? <Check size={size} /> : <Copy size={size} />}
    </button>
  )
}

export function CommandHint({ command, lead = 'On the gateway host, run' }: { command: string; lead?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
      {lead && <span>{lead}</span>}
      <code className="px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
        {command}
      </code>
      <CopyButton value={command} title="Copy command" />
    </span>
  )
}

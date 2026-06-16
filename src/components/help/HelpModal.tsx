import { useState, useEffect } from 'react'
import { X, Rocket, Keyboard, LifeBuoy, Info, ExternalLink } from 'lucide-react'
import type { HelpTab } from '../../store/help'

type Tab = HelpTab

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'start',           label: 'Getting Started',  icon: <Rocket size={14} /> },
  { id: 'shortcuts',       label: 'Shortcuts',        icon: <Keyboard size={14} /> },
  { id: 'troubleshooting', label: 'Troubleshooting',  icon: <LifeBuoy size={14} /> },
  { id: 'about',           label: 'About',            icon: <Info size={14} /> },
]

const DOCS_URL = 'https://docs.openclaw.ai'

// External links route through the main process's window-open handler → shell.openExternal
function openExternal(url: string) {
  window.open(url, '_blank')
}

export function HelpModal({ onClose, initialTab }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'start')

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 z-50 flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)', width: 680, height: '74vh', maxHeight: 640,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Help</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Tab rail */}
          <div className="flex flex-col gap-1 p-3 shrink-0" style={{ width: 180, borderRight: '1px solid var(--border)' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded"
                style={{
                  background: tab === t.id ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-elevated))' : 'transparent',
                  color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                  border: 'none', cursor: 'pointer', borderRadius: 'var(--radius)',
                }}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'start'           && <GettingStarted />}
            {tab === 'shortcuts'       && <Shortcuts />}
            {tab === 'troubleshooting' && <Troubleshooting />}
            {tab === 'about'           && <About />}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Sections ──────────────────────────────────────────────────────────────────

function GettingStarted() {
  return (
    <Section title="Getting Started">
      <Step n={1} title="Connect to your gateway">
        On the connect screen, enter your gateway URL (e.g. <Code>ws://localhost:18789</Code>) and bearer
        token — or click <b>Auto-fill from config</b> to read them from your local Openclaw config. Generate a
        token with <Code>openclaw doctor --generate-gateway-token</Code>.
      </Step>
      <Step n={2} title="Create an agent">
        Go to <b>Agents → New Agent</b>. The agent id is derived from the name. Leave <b>Workspace</b> blank to
        use the gateway default (<Code>&lt;defaults.workspace&gt;/&lt;agent-id&gt;</Code>), and optionally set a model.
      </Step>
      <Step n={3} title="Start a chat">
        Open <b>Chats</b>, click <b>+</b>, and pick an agent. From the chat header you can override the
        <b> model</b> and <b>thinking level</b> for that conversation only — without changing the agent's config.
      </Step>
      <Step n={4} title="Explore">
        <b>Sessions</b> shows live and past runs, <b>Models</b> manages providers, <b>Crons</b> schedules agent
        turns, and <b>Settings</b> controls the gateway connection.
      </Step>
    </Section>
  )
}

function Shortcuts() {
  const rows: [string, string][] = [
    ['Enter', 'Send the current message'],
    ['Shift + Enter', 'Insert a new line in the composer'],
    ['Ctrl / ⌘ + S', 'Save the open agent file (file editor)'],
    ['Escape', 'Close the open editor / cancel an inline edit'],
    ['Enter', 'Confirm inline forms (create agent, add model, rename session)'],
  ]
  return (
    <Section title="Keyboard Shortcuts">
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Shortcuts are contextual to the focused area.
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map(([keys, desc], i) => (
          <div key={i} className="flex items-center gap-3 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <Kbd>{keys}</Kbd>
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{desc}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

function Troubleshooting() {
  return (
    <Section title="Troubleshooting">
      <Issue q="Can't connect to the gateway">
        Confirm the gateway is running (<Code>openclaw gateway status</Code>) and that the URL, port, and token
        match. Unreachable hosts now fail after ~12s with a <b>Connection failed</b> banner — expand the
        <b> connection log</b> on the connect screen for the exact error.
      </Issue>
      <Issue q="“Auth rejected by gateway”">
        The token doesn't match the gateway's configured token. Regenerate it with
        <Code>openclaw doctor --generate-gateway-token</Code> and paste the new value.
      </Issue>
      <Issue q="Ollama models missing or not loaded">
        Make sure Ollama is running (it serves on <Code>:11434</Code>). The Models panel reflects your gateway's
        configured providers; a green dot means the model is currently loaded in Ollama.
      </Issue>
      <Issue q="Why are there two Ollama services (:11434 and :11435)?">
        Ollama runs one request at a time per model, so a scheduled CRON job sharing a single Ollama can
        interrupt your live chat. A second isolated instance keeps them apart: <b>:11434</b> for
        interactive chats/agents, <b>:11435</b> for background CRON jobs (jobs use the
        <Code>ollama-cron/</Code> model prefix). Configure each instance's URL in <b>Settings → Ollama
        Endpoints</b> — needed when the gateway runs on a remote host.
      </Issue>
      <Issue q="No prompt-processing progress in chat">
        That progress is read from Ollama's local logs and only appears for longer prompts on a local Ollama
        instance — short prompts finish in a single step and emit no progress.
      </Issue>
      <Issue q="Agent or config changes didn't apply">
        The gateway hot-reloads its config on change. If something looks stale, restart it
        (<Code>openclaw gateway restart</Code>) or use the controls in <b>Settings</b>.
      </Issue>
    </Section>
  )
}

function About() {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    const api = (window as unknown as { api?: { app?: { version: () => Promise<string> } } })?.api?.app
    api?.version().then(setVersion).catch(() => {})
  }, [])

  return (
    <Section title="About">
      <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
        <b>JoaxClaw</b>{version ? ` v${version}` : ''}
      </p>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        A desktop UI for the Openclaw Gateway — manage agents, chats, sessions, models, and scheduled runs.
        Built with Electron and React.
      </p>
      <button
        onClick={() => openExternal(DOCS_URL)}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', borderRadius: 'var(--radius)' }}
      >
        <ExternalLink size={14} />
        Openclaw documentation
      </button>
    </Section>
  )
}

// ── Building blocks ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div
        className="flex items-center justify-center shrink-0 text-xs font-semibold"
        style={{ width: 22, height: 22, borderRadius: '50%', background: 'color-mix(in srgb, var(--accent) 18%, var(--bg-elevated))', color: 'var(--accent)' }}
      >
        {n}
      </div>
      <div>
        <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{title}</p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{children}</p>
      </div>
    </div>
  )
}

function Issue({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{q}</p>
      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{children}</p>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: 'monospace', fontSize: 12, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
      {children}
    </code>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 text-xs font-mono"
      style={{ minWidth: 110, padding: '3px 8px', borderRadius: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', textAlign: 'center' }}
    >
      {children}
    </span>
  )
}

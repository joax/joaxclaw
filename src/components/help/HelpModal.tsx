import { useState, useEffect } from 'react'
import { X, Rocket, Keyboard, LifeBuoy, Info, ExternalLink, Network, CheckCircle2, XCircle, UsersRound } from 'lucide-react'
import type { HelpTab } from '../../store/help'

type Tab = HelpTab

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'start',           label: 'Getting Started',  icon: <Rocket size={14} /> },
  { id: 'shortcuts',       label: 'Shortcuts',        icon: <Keyboard size={14} /> },
  { id: 'gateways',        label: 'Gateways',         icon: <Network size={14} /> },
  { id: 'remote-teams',    label: 'Remote Teams',     icon: <UsersRound size={14} /> },  // Teams + Processes
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
            {tab === 'gateways'        && <Gateways />}
            {tab === 'remote-teams'    && <RemoteTeams />}
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

// Visual: how the client, gateway, and local LLM engines connect.
function ConnectionDiagram() {
  const border = 'var(--border)'
  const textC = 'var(--text-primary)'
  const subC = 'var(--text-secondary)'
  const accent = 'var(--accent)'
  const surface = 'var(--bg-elevated)'

  const Box = (x: number, title: string, sub: string) => (
    <g>
      <rect x={x} y={44} width={118} height={62} rx={8} style={{ fill: surface, stroke: border }} strokeWidth={1} />
      <text x={x + 59} y={72} textAnchor="middle" style={{ fill: textC, fontSize: 11, fontWeight: 600 }}>{title}</text>
      <text x={x + 59} y={88} textAnchor="middle" style={{ fill: subC, fontSize: 8.5 }}>{sub}</text>
    </g>
  )

  return (
    <div style={{ background: 'var(--bg-surface)', border: `1px solid ${border}`, borderRadius: 'var(--radius)', padding: 12 }}>
      <svg viewBox="0 0 480 196" width="100%" style={{ maxWidth: 460, display: 'block', margin: '0 auto' }}>
        <defs>
          <marker id="cd-arr" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" style={{ fill: subC }} />
          </marker>
          <marker id="cd-arr-s" markerWidth="9" markerHeight="9" refX="0" refY="3" orient="auto">
            <path d="M6,0 L0,3 L6,6 Z" style={{ fill: subC }} />
          </marker>
          <marker id="cd-arr-a" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" style={{ fill: accent }} />
          </marker>
        </defs>

        {/* Nodes */}
        {Box(6, 'JoaxClaw', 'client · probe')}
        {Box(181, 'Gateway', 'WebSocket server')}
        {Box(356, 'Local LLM', 'Ollama · LM Studio…')}

        {/* Client ↔ Gateway: WebSocket */}
        <line x1={124} y1={75} x2={181} y2={75} style={{ stroke: subC }} strokeWidth={1.5}
          markerStart="url(#cd-arr-s)" markerEnd="url(#cd-arr)" />
        <text x={152} y={64} textAnchor="middle" style={{ fill: textC, fontSize: 8.5, fontWeight: 600 }}>WebSocket</text>
        <text x={152} y={92} textAnchor="middle" style={{ fill: subC, fontSize: 7.5 }}>control</text>

        {/* Gateway → Engines: HTTP on the gateway host */}
        <line x1={299} y1={75} x2={356} y2={75} style={{ stroke: subC }} strokeWidth={1.5} markerEnd="url(#cd-arr)" />
        <text x={327} y={64} textAnchor="middle" style={{ fill: textC, fontSize: 8.5, fontWeight: 600 }}>HTTP</text>
        <text x={327} y={92} textAnchor="middle" style={{ fill: subC, fontSize: 7.5 }}>inference</text>

        {/* Client → Engines: direct health probe (bypasses the gateway) */}
        <path d="M65,106 C 65,168 415,168 415,106" fill="none" style={{ stroke: accent }} strokeWidth={1.5}
          strokeDasharray="4 3" markerEnd="url(#cd-arr-a)" />
        <text x={240} y={150} textAnchor="middle" style={{ fill: accent, fontSize: 8.5, fontWeight: 600 }}>direct health probe</text>
        <text x={240} y={186} textAnchor="middle" style={{ fill: subC, fontSize: 7.5 }}>local: direct · remote: via Tailscale / LAN</text>
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
        <Legend color={subC} dashed={false}>WebSocket &amp; gateway→engine HTTP — always available</Legend>
        <Legend color={accent} dashed>Client probes engines directly — reachable on a local gateway; remote needs Tailscale/LAN</Legend>
      </div>
    </div>
  )
}

function Legend({ color, dashed, children }: { color: string; dashed: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5" style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
      <span style={{ width: 16, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`, flexShrink: 0 }} />
      {children}
    </span>
  )
}

function Gateways() {
  return (
    <Section title="Local vs Remote Gateways">
      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        JoaxClaw talks to the Openclaw Gateway over a WebSocket. Chats, sessions, agents,
        models, and crons all work the same whether the gateway is on this machine or
        elsewhere. The difference is anything that touches the gateway <b>host's</b> filesystem,
        local services, or loopback ports — those only work when the gateway is <b>local</b>.
      </p>

      <ConnectionDiagram />

      <div>
        <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Local gateway</p>
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Runs on this same machine (URL host is <Code>localhost</Code> / <Code>127.0.0.1</Code>). The app can
          reach its files and local services directly.
        </p>
        <Cap ok>Edit the gateway config file and restart/stop it from Settings → Gateway</Cap>
        <Cap ok>Health-check local engines (Ollama, LM Studio, vLLM, …) by probing localhost ports</Cap>
        <Cap ok>Install app-native skills by writing to <Code>~/.openclaw/skills</Code></Cap>
      </div>

      <div>
        <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Remote gateway</p>
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Runs on another host (e.g. a server reached over a VPN). Only its WebSocket port is
          reachable from here, so host-local operations must go <b>through the gateway</b>.
        </p>
        <Cap ok>Chat, sessions, agents, models, crons — everything over the WebSocket</Cap>
        <Cap>Config file editing &amp; restart/stop controls act on <i>your</i> machine, not the server</Cap>
        <Cap>Local engines on the server's loopback can't be probed — shown as <b>unknown</b> instead of offline</Cap>
        <Cap>App-native skills are uploaded over the gateway (see below) instead of written to disk</Cap>
      </div>

      <div>
        <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Reaching remote engines over Tailscale</p>
        <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Local engines usually bind to <Code>127.0.0.1</Code> on the gateway host, so JoaxClaw can't probe
          them from another machine (they show as <b>unknown</b>). <b>Tailscale</b> — a mesh VPN — gives both
          machines a stable private address, so you can reach the engine directly and point JoaxClaw at it.
        </p>
        <Step n={1} title="Join both machines to one tailnet">
          Install Tailscale on the gateway host and on this machine and sign in to the same account. Find the
          host's address with <Code>tailscale ip -4</Code> or its MagicDNS name <Code>{'<host>.<tailnet>.ts.net'}</Code>.
        </Step>
        <Step n={2} title="Expose the engine beyond loopback">
          Make the engine listen on more than <Code>127.0.0.1</Code>:
          <br />• <b>Ollama</b> — set <Code>OLLAMA_HOST=0.0.0.0:11434</Code> and restart it.
          <br />• <b>vLLM / llama.cpp</b> — start with <Code>--host 0.0.0.0</Code>.
          <br />• <b>LM Studio</b> — enable "Serve on local network" in the server tab.
          <br />Or, without changing the bind, run <Code>tailscale serve 11434</Code> to proxy it over the tailnet.
        </Step>
        <Step n={3} title="Point JoaxClaw at the tailnet URL">
          In <b>Settings → Ollama</b> (Ollama Endpoints) — or the per-chat / Crons engine controls — set the
          engine URL to the host's tailnet address, e.g. <Code>{'http://<host>.<tailnet>.ts.net:11434'}</Code>.
          Health checks run from the app's main process (not the browser), so they reach the tailnet directly.
        </Step>
        <p className="text-xs mt-1.5" style={{ color: 'var(--warning)', lineHeight: 1.5 }}>
          Security: <Code>0.0.0.0</Code> exposes the engine on every network the host is connected to. Prefer
          binding to the Tailscale interface IP, use <Code>tailscale serve</Code>, or restrict access with
          Tailscale ACLs.
        </p>
      </div>

      <Issue q="Installing skills on a remote gateway">
        Remote skill install uploads an archive over the WebSocket
        (<Code>skills.upload.*</Code> → <Code>skills.install</Code>). The gateway only accepts this when the
        config flag <Code>skills.install.allowUploadedArchives</Code> is <b>true</b>. If it's disabled you'll see
        <i> "Uploaded skill archive installs are disabled by skills.install.allowUploadedArchives"</i> in
        Settings → Skills. Set the flag to <Code>true</Code> in the gateway config and reconnect (or press
        Reinstall). On a local gateway this flag isn't needed — skills are written to disk directly.
      </Issue>
    </Section>
  )
}

function Cap({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      {ok
        ? <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
        : <XCircle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />}
      <span className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

function RemoteTeams() {
  return (
    <Section title="Teams & Processes on a remote gateway">
      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Teams and processes are stored as files in the gateway host's <Code>~/.openclaw/teams</Code> and{' '}
        <Code>~/.openclaw/processes</Code>, and agents write there too (via the <Code>teams-blueprint</Code> /
        {' '}<Code>process-builder</Code> skills). On a gateway running on <b style={{ color: 'var(--text-primary)' }}>another machine</b>,
        JoaxClaw can't read those files directly. Installing the small <b style={{ color: 'var(--text-primary)' }}>joaxclaw-fs</b> plugin
        on the host exposes them over the connection (<Code>teams.*</Code> / <Code>processes.*</Code> RPC), and the
        full Teams and Processes UIs work remotely — including ones your agents create. One install covers both, and
        you only do it <b style={{ color: 'var(--text-primary)' }}>once per gateway host</b>.
      </p>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Easiest: on the remote Teams or Processes screen, click <b style={{ color: 'var(--text-primary)' }}>Install
          via agent</b> — JoaxClaw hands an agent on the host a script that installs the plugin and restarts the
          gateway. You just approve the command. The manual steps below do the same thing by hand.
        </p>
      </div>

      <Step n={1} title="Install it on the gateway host">
        If the host has internet, install from npm — one line:
        <span style={{ display: 'block', marginTop: 8 }}>
          <Code>openclaw plugins install openclaw-joaxclaw-fs && openclaw plugins allow joaxclaw-fs</Code>
        </span>
        <span style={{ display: 'block', marginTop: 6, opacity: 0.8 }}>
          Offline / from source: the plugin ships at <Code>plugins/joaxclaw-fs</Code> (copy it up with{' '}
          <Code>scp -r plugins/joaxclaw-fs you@host:~/joaxclaw-fs</Code> if needed), then{' '}
          <Code>openclaw plugins install --link ~/joaxclaw-fs</Code> — a packed tarball works too
          (<Code>openclaw plugins install npm-pack:./openclaw-joaxclaw-fs-0.2.0.tgz</Code>).
        </span>
      </Step>

      <Step n={2} title="Restart the gateway">
        Load the new plugin with <Code>openclaw gateway restart</Code>. Confirm it's active with{' '}
        <Code>openclaw plugins list</Code> — you should see <b style={{ color: 'var(--text-primary)' }}>joaxclaw-fs · enabled</b>.
      </Step>

      <Step n={3} title="Back in JoaxClaw">
        Reconnect (or press <b style={{ color: 'var(--text-primary)' }}>Retry</b> on the Teams/Processes screen).
        Both now load over the WebSocket and behave exactly as on a local gateway — create, edit, delete, and view
        agent-authored teams and processes. No app update needed; JoaxClaw uses the plugin automatically when present.
      </Step>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-elevated))', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
        <Info size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          The plugin only reads and writes the <Code>teams/</Code> and <Code>processes/</Code> directories and
          requires the same operator auth as every other gateway call — no new access beyond your existing connection.
        </p>
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

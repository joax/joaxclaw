import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Brain, Check, SlidersHorizontal, Wrench, Layers } from 'lucide-react'
import { ModelIcon } from '../ui/ModelIcon'
import { useModelsStore } from '../../store/models'
import { useMetricsStore } from '../../store/metrics'
import { THINKING_LEVELS, type ThinkingLevel } from '../../lib/types'

// ── Shared popover button shell ───────────────────────────────────────────────

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  return ref
}

const triggerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '3px 7px', fontSize: 11, maxWidth: 200,
  borderRadius: 'var(--radius)', border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  cursor: 'pointer', whiteSpace: 'nowrap',
}

const menuStyle: React.CSSProperties = {
  position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 100,
  minWidth: 220, maxHeight: 320, overflowY: 'auto', paddingBlock: 4,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
}

function shortModel(full: string): string {
  const slash = full.indexOf('/')
  return slash >= 0 ? full.slice(slash + 1) : full
}

// ── Model select ──────────────────────────────────────────────────────────────

export function ModelSelect({ value, agentDefault, onChange }: {
  value?: string
  agentDefault?: string
  onChange: (model: string | null) => void
}) {
  const { providers, load } = useModelsStore()
  const { ollamaModels } = useMetricsStore()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useClickOutside(() => setOpen(false))

  useEffect(() => { if (open) load() }, [open])

  const loadedSet = new Set(ollamaModels.filter(m => m.loaded).map(m => `ollama/${m.name}`))
  const q = search.toLowerCase()
  const groups = Object.entries(providers)
    .map(([pid, p]) => ({
      pid,
      models: p.models
        .map(m => ({ fullId: `${pid}/${m.id}`, displayId: m.id, loaded: loadedSet.has(`${pid}/${m.id}`) }))
        .filter(m => !q || m.fullId.toLowerCase().includes(q)),
    }))
    .filter(g => g.models.length > 0)

  const label = value ? shortModel(value) : agentDefault ? `${shortModel(agentDefault)}` : 'Agent default'

  function pick(model: string | null) {
    onChange(model)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={value ? `Chat model override: ${value}` : 'Using the agent default model — click to override for this chat'}
        style={{ ...triggerStyle, color: value ? 'var(--accent)' : 'var(--text-secondary)' }}
      >
        <ModelIcon model={value ?? agentDefault ?? 'model'} size={11} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>{label}</span>
        {!value && <span style={{ opacity: 0.55 }}>· default</span>}
        <ChevronDown size={11} style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div style={menuStyle}>
          <div style={{ padding: '4px 8px' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models…"
              autoFocus
              style={{
                width: '100%', padding: '5px 8px', fontSize: 12, boxSizing: 'border-box',
                borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none',
              }}
            />
          </div>

          <MenuRow selected={!value} onClick={() => pick(null)}>
            <span style={{ flex: 1 }}>Agent default{agentDefault ? <span style={{ opacity: 0.5, fontFamily: 'monospace' }}> · {shortModel(agentDefault)}</span> : ''}</span>
          </MenuRow>

          {groups.length === 0 && (
            <p style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>No matching models</p>
          )}
          {groups.map(group => (
            <div key={group.pid}>
              <p style={{ padding: '5px 12px 2px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>
                {group.pid}
              </p>
              {group.models.map(m => (
                <MenuRow key={m.fullId} selected={value === m.fullId} onClick={() => pick(m.fullId)}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: m.loaded ? 'var(--success)' : 'var(--border)' }} />
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{m.displayId}</span>
                </MenuRow>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Thinking-level select ─────────────────────────────────────────────────────

export function ThinkingSelect({ value, onChange }: {
  value?: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false))
  const current = value ?? 'adaptive'
  const currentLabel = THINKING_LEVELS.find(l => l.value === current)?.label ?? 'Adaptive'
  const overridden = current !== 'adaptive'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`Thinking level for this chat: ${currentLabel}`}
        style={{ ...triggerStyle, color: overridden ? 'var(--accent)' : 'var(--text-secondary)' }}
      >
        <Brain size={11} style={{ flexShrink: 0 }} />
        <span>{currentLabel}</span>
        <ChevronDown size={11} style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ ...menuStyle, minWidth: 150 }}>
          {THINKING_LEVELS.map(l => (
            <MenuRow key={l.value} selected={l.value === current} onClick={() => { onChange(l.value); setOpen(false) }}>
              <span style={{ flex: 1 }}>{l.label}</span>
            </MenuRow>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared menu row ───────────────────────────────────────────────────────────

function MenuRow({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 12px', background: 'none', border: 'none',
        cursor: 'pointer', textAlign: 'left',
        color: selected ? 'var(--accent)' : 'var(--text-primary)',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-primary)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {children}
      {selected && <Check size={12} style={{ flexShrink: 0 }} />}
    </button>
  )
}

// ── Display menu ──────────────────────────────────────────────────────────────
// Collapses the presentation controls (Basic/Advanced + the multi-select Reasoning /
// Actions / Context toggles) into one popover so the chat header stays uncluttered —
// important in the narrow pop-out chat window.

export function DisplayMenu({
  mode, setMode, reasoning, setReasoning, actions, setActions, context, setContext,
}: {
  mode: 'basic' | 'advanced'
  setMode: (m: 'basic' | 'advanced') => void
  reasoning: boolean; setReasoning: (v: boolean) => void
  actions: boolean;   setActions: (v: boolean) => void
  context: boolean;   setContext: (v: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false))
  const advanced = mode === 'advanced'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        style={triggerStyle}
        onClick={() => setOpen(o => !o)}
        title="Display options"
      >
        <SlidersHorizontal size={12} />
        <span className="capitalize">{mode}</span>
        <ChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div style={{ ...menuStyle, minWidth: 190 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-secondary)', padding: '2px 10px' }}>
            Presentation
          </p>
          <div style={{ padding: '2px 8px 6px' }}>
            <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {(['basic', 'advanced'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="flex-1 text-xs px-2 py-1 capitalize transition-colors"
                  style={{
                    background: mode === m ? 'var(--accent)' : 'transparent',
                    color: mode === m ? '#fff' : 'var(--text-secondary)',
                    border: 'none', cursor: 'pointer',
                  }}
                >{m}</button>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-secondary)', padding: '4px 10px 2px' }}>
            Show in messages
          </p>
          <CheckRow label="Reasoning" icon={<Brain size={12} />}  checked={reasoning} disabled={!advanced} onToggle={() => setReasoning(!reasoning)} />
          <CheckRow label="Actions"   icon={<Wrench size={12} />} checked={actions}   disabled={!advanced} onToggle={() => setActions(!actions)} />
          <CheckRow label="Context"   icon={<Layers size={12} />} checked={context}   disabled={!advanced} onToggle={() => setContext(!context)} />
        </div>
      )}
    </div>
  )
}

function CheckRow({ label, icon, checked, disabled, onToggle }: {
  label: string; icon: React.ReactNode; checked: boolean; disabled?: boolean; onToggle: () => void
}) {
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-xs"
      style={{
        background: 'none', border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? 'var(--text-secondary)' : 'var(--text-primary)',
        opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-primary)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      <span style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        {checked && <Check size={12} style={{ color: 'var(--accent)' }} />}
      </span>
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  )
}

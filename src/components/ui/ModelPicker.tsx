import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useModelsStore } from '../../store/models'
import { useMetricsStore } from '../../store/metrics'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputStyle?: React.CSSProperties
}

export function ModelPicker({ value, onChange, placeholder, inputStyle }: Props) {
  const { providers, loading, load } = useModelsStore()
  const { ollamaModels } = useMetricsStore()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(value)

  // Always reload on mount so the picker reflects the same data as the Models panel
  useEffect(() => { load() }, [])
  useEffect(() => { setSearch(value) }, [value])

  const loadedSet = new Set(ollamaModels.filter(m => m.loaded).map(m => `ollama/${m.name}`))

  const groups = Object.entries(providers)
    .map(([pid, p]) => ({
      pid,
      models: p.models.map(m => ({
        fullId: `${pid}/${m.id}`,
        displayId: m.id,
        name: m.name !== m.id ? m.name : undefined,
        loaded: loadedSet.has(`${pid}/${m.id}`)
      }))
    }))
    .filter(g => g.models.length > 0)

  const q = search.toLowerCase()
  const filteredGroups = groups
    .map(g => ({ ...g, models: g.models.filter(m => !q || m.fullId.toLowerCase().includes(q)) }))
    .filter(g => g.models.length > 0)

  function handleSelect(fullId: string) {
    onChange(fullId)
    setSearch(fullId)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); onChange(e.target.value); setOpen(true) }}
          onFocus={e => { setOpen(true); e.currentTarget.style.borderColor = 'var(--accent)' }}
          onBlur={e => { setTimeout(() => setOpen(false), 120); e.currentTarget.style.borderColor = 'var(--border)' }}
          placeholder={placeholder ?? 'e.g. ollama/qwen3.5:8b'}
          style={{
            display: 'block', width: '100%', padding: '7px 12px',
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            fontSize: 14, outline: 'none', boxSizing: 'border-box',
            ...inputStyle
          }}
        />
        {loading && (
          <Loader2 size={13} className="animate-spin" style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-secondary)', pointerEvents: 'none'
          }} />
        )}
      </div>
      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
          zIndex: 100, paddingBlock: 4, maxHeight: 280, overflowY: 'auto',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(0,0,0,0.35)'
        }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
              <Loader2 size={12} className="animate-spin" /> Loading models…
            </div>
          ) : filteredGroups.length === 0 ? (
            <p style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
              {groups.length === 0 ? 'No models configured' : 'No matching models'}
            </p>
          ) : filteredGroups.map(group => (
            <div key={group.pid}>
              {groups.length > 1 && (
                <p style={{ padding: '5px 12px 2px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)', userSelect: 'none' }}>
                  {group.pid}
                </p>
              )}
              {group.models.map(m => (
                <button key={m.fullId} onMouseDown={() => handleSelect(m.fullId)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 12px', background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'left'
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: m.loaded ? 'var(--success)' : 'var(--border)' }} />
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }}>
                    {groups.length > 1
                      ? <><span style={{ opacity: 0.5 }}>{group.pid}/</span>{m.displayId}</>
                      : m.displayId}
                  </span>
                  {m.name && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.name}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

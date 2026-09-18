import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Search, Video } from 'lucide-react'
import { useMeetingsStore } from '../../store/meetings'
import { useConnectionStore } from '../../store/connection'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { useGatewaySupport } from '../../lib/useGatewaySupport'
import { canonicalProvider, meetingMeta, meetingPill, meetingTitle, providerFilters, type TranscriptSession } from '../../lib/meetings'
import { toneColor, toneTint } from '../../lib/stateTone'
import { Btn } from '../ui/Btn'
import { Pill } from '../ui/Pill'
import { FilterTab } from '../ui/FilterTab'
import { EmptyState } from '../ui/EmptyState'
import { MeetingReader } from './MeetingReader'

// Meetings: the gateway's meeting notes. A list column and a reader, the same split as
// Processes and Teams; on a phone the list is the page and a row pushes the reader.
//
// "Notes", never "recordings": the gateway keeps caption text and a summary, not audio.

export function MeetingsView({ onOpenChat, header, top }: {
  onOpenChat?: () => void
  /** Extra header actions (Record a meeting, in the recording PR). */
  header?: ReactNode
  /** Content above the list (the setup checklist, in the recording PR). */
  top?: ReactNode
}) {
  const narrow = useIsNarrow()
  const seq = useConnectionStore(s => s.connectionSeq)
  const connected = useConnectionStore(s => s.status === 'connected')
  const { supported } = useGatewaySupport({ methods: ['transcripts.list'] })
  const {
    sessions, status, nextCursor, listState, listError, loadingMore, query, provider, selected,
    setVisible, load, loadMore, setQuery, setProvider, open, close,
  } = useMeetingsStore()
  const [draft, setDraft] = useState(query)

  // Poll while this view is on screen (and while a meeting is live, which the store
  // decides for itself). Reload everything on every new connection.
  useEffect(() => {
    setVisible(true, narrow)
    return () => setVisible(false)
  }, [narrow, setVisible])
  useEffect(() => { if (connected && supported) void load() }, [seq, connected, supported, load])

  useEffect(() => {
    if (draft.trim() === query.trim()) return
    const t = setTimeout(() => setQuery(draft), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // Live meetings first (from status, which is fresher than the list), then the library.
  const rows = useMemo(() => {
    const live = (status?.active ?? []).filter(a => !provider || canonicalProvider(a.providerId) === provider)
    const liveIds = new Set(live.map(a => a.selector))
    return [...live, ...sessions.filter(s => !liveIds.has(s.selector))]
  }, [sessions, status, provider])
  const filters = useMemo(() => providerFilters([...sessions, ...(status?.active ?? [])].map(s => s.providerId)), [sessions, status])

  if (!supported) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={Video} label="This gateway doesn't keep meeting notes." hint="Meeting notes need OpenClaw 2026.8 or later." />
      </div>
    )
  }

  const showList = !narrow || !selected
  const showReader = !!selected

  const list = (
    <div className="flex flex-col min-h-0 h-full" style={{ opacity: connected ? 1 : 0.6 }}>
      <div className="flex flex-col gap-2 px-4 pt-4 pb-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Meetings</h1>
          {header}
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input value={draft} onChange={e => setDraft(e.target.value.slice(0, 256))} onKeyDown={e => { if (e.key === 'Enter') setQuery(draft) }}
            placeholder="Search meetings…" aria-label="Search meetings"
            style={{ width: '100%', padding: '6px 10px 6px 28px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }} />
        </div>
        {filters.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto" role="toolbar" aria-label="Filter by platform">
            <FilterTab label="All" active={!provider} onClick={() => setProvider(null)} />
            {filters.map(f => <FilterTab key={f.id} label={f.label} active={provider === f.id} onClick={() => setProvider(f.id)} />)}
          </div>
        )}
        {!connected && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Reconnecting…</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
        {top}
        {listState === 'loading' && sessions.length === 0 && (
          <>
            <span className="sr-only" role="status">Loading meetings…</span>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} aria-hidden className="animate-pulse" style={{ height: 52, borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', flexShrink: 0 }} />
            ))}
          </>
        )}
        {listState === 'error' && listError?.kind === 'forbidden' && (
          <EmptyState icon={Video} label="Your connection can't read the meeting archive. Ask a gateway admin for access." />
        )}
        {listState === 'error' && listError?.kind !== 'forbidden' && (
          <div className="text-xs px-2.5 py-2 rounded flex items-start gap-2" style={{ background: toneTint('failed', 10), color: 'var(--danger)' }}>
            <span style={{ flex: 1 }}>Couldn&apos;t read the meeting archive: {listError?.message}</span>
            <Btn size="sm" variant="outline" onClick={() => void load()}>Try again</Btn>
          </div>
        )}
        {listState === 'ready' && rows.length === 0 && (
          query.trim()
            ? <EmptyState icon={Video} label={`No meetings match “${query.trim()}”.`} />
            : <EmptyState icon={Video} label="No meeting notes yet. Record a meeting, or set up Discord auto-record." />
        )}
        {rows.length > 0 && (
          <div role="listbox" aria-label="Meetings" className="flex flex-col gap-1.5" onKeyDown={listKeys}>
            {rows.map(s => (
              <MeetingRow key={s.selector} session={s} selected={s.selector === selected} onOpen={() => void open(s.selector)} />
            ))}
          </div>
        )}
        {nextCursor && listState === 'ready' && (
          <div className="flex justify-center py-1">
            <Btn size="sm" variant="outline" loading={loadingMore} onClick={() => void loadMore()}>Load more</Btn>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 min-h-0">
      {showList && (
        <div className="flex flex-col min-h-0" style={{ width: narrow ? '100%' : 340, flexShrink: 0, borderRight: narrow ? 'none' : '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          {list}
        </div>
      )}
      {showReader && (
        <div className="flex-1 min-w-0 min-h-0">
          <MeetingReader narrow={narrow} onBack={narrow ? close : undefined} onOpenChat={onOpenChat} />
        </div>
      )}
      {!narrow && !selected && (
        <div className="flex-1 min-w-0 flex">
          <EmptyState icon={Video} label="Pick a meeting to read its notes." />
        </div>
      )}
    </div>
  )
}

function MeetingRow({ session: s, selected, onOpen }: { session: TranscriptSession; selected: boolean; onOpen: () => void }) {
  const pill = meetingPill(s)
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-nav-item
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter') onOpen() }}
      className="flex flex-col gap-0.5 px-3 py-2"
      style={{
        cursor: 'pointer', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: selected ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))' : 'var(--bg-elevated)',
      }}
    >
      <div className="flex items-center gap-2">
        {s.active && <span className="animate-pulse-dot inline-block rounded-full shrink-0" style={{ width: 7, height: 7, background: toneColor('working') }} />}
        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', flex: 1 }}>{meetingTitle(s)}</span>
        {pill && <Pill tone={pill.tone}>{pill.text}</Pill>}
      </div>
      <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{meetingMeta(s)}</span>
    </div>
  )
}

// Up/Down between rows, as a listbox does.
function listKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]'))
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  items[e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1)]?.focus()
}

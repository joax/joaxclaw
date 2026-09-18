import { useEffect } from 'react'
import { Video } from 'lucide-react'
import type { NavSection } from '../../App'
import { useMeetingsStore } from '../../store/meetings'
import { useConnectionStore } from '../../store/connection'
import { useGatewaySupport } from '../../lib/useGatewaySupport'
import { durationLabel, meetingDate, meetingTitle, recentMeetings, sessionProvider } from '../../lib/meetings'
import { toneColor } from '../../lib/stateTone'
import { MobileCard, SectionHead, SeeAll } from '../dashboard/DashboardView'

// The Dashboard's "Recent meetings": anything being noted right now, then the last three.
// Hidden when the gateway keeps no notes, or has none yet. A row opens it in Meetings.
export function RecentMeetingsSection({ onNavigate, narrow }: { onNavigate: (s: NavSection) => void; narrow?: boolean }) {
  const { supported } = useGatewaySupport({ methods: ['transcripts.list'] })
  const seq = useConnectionStore(s => s.connectionSeq)
  const sessions = useMeetingsStore(s => s.sessions)
  const status = useMeetingsStore(s => s.status)
  const load = useMeetingsStore(s => s.load)
  const open = useMeetingsStore(s => s.open)

  useEffect(() => { if (supported) void load() }, [supported, seq, load])

  if (!supported) return null
  const rows = recentMeetings(sessions, status?.active ?? [])
  if (rows.length === 0) return null

  const go = (selector: string) => { void open(selector); onNavigate('meetings') }
  const content = (
    <>
      <SectionHead Icon={Video} label="Recent meetings" narrow action={<SeeAll narrow={narrow} onClick={() => onNavigate('meetings')} />} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 2 : 4 }}>
        {rows.map(s => (
          <button key={s.selector} onClick={() => go(s.selector)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '8px 0' : '5px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
            <span className={s.active ? 'animate-pulse-dot' : undefined}
              style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: s.active ? toneColor('working') : 'transparent' }} />
            <span style={{ fontSize: narrow ? 14 : 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meetingTitle(s)}
            </span>
            <span style={{ fontSize: narrow ? 12 : 10, color: s.active ? toneColor('working') : 'var(--text-secondary)', flexShrink: 0, opacity: s.active ? 1 : 0.7 }}>
              {s.active ? `${sessionProvider(s)} · live` : `${meetingDate(s.startedAt).split(' ')[0]} · ${durationLabel(s.startedAt, s.stoppedAt)}`}
            </span>
          </button>
        ))}
      </div>
    </>
  )
  return narrow ? <MobileCard>{content}</MobileCard> : <div style={{ marginBottom: 16 }}>{content}</div>
}

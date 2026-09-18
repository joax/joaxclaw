import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronDown, Download, MessageSquarePlus, Sparkles, Search } from 'lucide-react'
import { useMeetingsStore, focusChat } from '../../store/meetings'
import { useAgentsStore } from '../../store/agents'
import { useGatewaySupport } from '../../lib/useGatewaySupport'
import {
  meetingMeta, meetingTitle, summaryHasStructure, tooLargeCommand, type StoredSummary, type Utterance,
} from '../../lib/meetings'
import { toneColor, toneTint } from '../../lib/stateTone'
import { MarkdownContent } from '../chat/MarkdownContent'
import { Btn } from '../ui/Btn'
import { Pill } from '../ui/Pill'
import { FilterTab } from '../ui/FilterTab'
import { Popover, MenuRow } from '../ui/Popover'
import { CommandHint } from '../ui/CommandHint'

// One meeting: what was decided and who does what first, then the transcript when you
// need to check. Summary before transcript is what every notes product converges on.
// Everything from the gateway renders as text or Markdown, never as HTML.

export function MeetingReader({ narrow, onBack, onOpenChat }: {
  narrow: boolean
  onBack?: () => void
  onOpenChat?: () => void
}) {
  const {
    detail, detailState, detailError, selected, tab, summarizing, status,
    setTab, downloadAs, summarize, discuss, open,
  } = useMeetingsStore()
  const canExport = useGatewaySupport({ methods: ['transcripts.export'] }).supported
  const agents = useAgentsStore(s => s.agents)
  const defaultAgent = useAgentsStore(s => s.defaultId)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [agentMenu, setAgentMenu] = useState(false)

  if (!selected) return null
  if (detailState === 'loading' && !detail) return <ReaderSkeleton />
  if (detailState === 'error' || !detail) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {onBack && <BackButton onBack={onBack} />}
        <div className="text-xs px-2.5 py-2 rounded flex items-start gap-2" style={{ background: toneTint('failed', 10), color: 'var(--danger)' }}>
          <span style={{ flex: 1 }}>{detailError ?? 'Couldn’t open this meeting.'}</span>
          <Btn size="sm" variant="outline" onClick={() => void open(selected)}>Try again</Btn>
        </div>
      </div>
    )
  }

  const s = detail.session
  // The transcripts tool (which writes summaries) isn't registered while capture is off.
  const captureOff = status?.enabled === false
  const summarizingThis = summarizing?.selector === s.selector
  const openChat = (convId: string) => { focusChat(convId); onOpenChat?.() }
  const startDiscuss = (agentId?: string) => {
    const convId = discuss(agentId)
    if (convId) openChat(convId)
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex flex-col gap-2 px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-start gap-2">
          {onBack && <BackButton onBack={onBack} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{meetingTitle(s)}</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{meetingMeta(s, { withTime: true })}</p>
          </div>
          {s.active && <Pill tone="working" icon={<span className="animate-pulse-dot inline-block rounded-full" style={{ width: 6, height: 6, background: toneColor('working') }} />}>Recording</Pill>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center">
            <Btn size="sm" variant="outline" icon={<MessageSquarePlus size={12} />} onClick={() => startDiscuss()}
              style={agents.length > 1 ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : undefined}>
              {narrow ? 'Discuss' : 'Discuss in a new chat'}
            </Btn>
            {agents.length > 1 && (
              <Popover open={agentMenu} onOpenChange={setAgentMenu} title="Discuss with" sheetOnNarrow align="left" width={200}
                trigger={p => (
                  <button {...p} title="Choose the agent" aria-label="Choose the agent"
                    style={{ height: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderLeft: 'none', borderTopRightRadius: 'var(--radius)', borderBottomRightRadius: 'var(--radius)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                    <ChevronDown size={12} />
                  </button>
                )}>
                {agents.map(a => (
                  <MenuRow key={a.id} selected={a.id === (s.agentId ?? defaultAgent)} onClick={() => { setAgentMenu(false); startDiscuss(a.id) }}>
                    <span style={{ fontSize: 12, flex: 1 }}>{a.identity?.name ?? a.name ?? a.id}</span>
                  </MenuRow>
                ))}
              </Popover>
            )}
          </div>
          {canExport && (
            <Popover open={downloadOpen} onOpenChange={setDownloadOpen} title="Download" sheetOnNarrow align="left" width={160}
              trigger={p => (
                <button {...p} className="inline-flex items-center gap-1.5" style={outlineBtn}>
                  <Download size={12} /> Download <ChevronDown size={11} />
                </button>
              )}>
              <MenuRow onClick={() => { setDownloadOpen(false); void downloadAs('markdown', { narrow }) }}><span style={{ fontSize: 12 }}>Markdown</span></MenuRow>
              <MenuRow onClick={() => { setDownloadOpen(false); void downloadAs('jsonl', { narrow }) }}><span style={{ fontSize: 12 }}>JSONL</span></MenuRow>
            </Popover>
          )}
          {!s.hasSummary && !captureOff && (
            <Btn size="sm" variant="outline" icon={<Sparkles size={12} />} loading={summarizingThis && !summarizing?.slow}
              disabled={summarizingThis} onClick={() => summarize()}>
              {summarizingThis ? 'Summarizing…' : 'Summarize'}
            </Btn>
          )}
        </div>
        <DownloadLine />
        <div role="tablist" aria-label="Meeting notes" className="flex items-center gap-1">
          <FilterTab label="Summary" active={tab === 'summary'} onClick={() => setTab('summary')} />
          <FilterTab label={s.active ? 'Transcript · Live' : 'Transcript'} active={tab === 'transcript'} onClick={() => setTab('transcript')} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3" style={{ userSelect: 'text' }}>
        {tab === 'summary'
          ? <SummaryTab summary={detail.summary} summarizing={summarizingThis ? summarizing : null} canSummarize={!captureOff}
              onSummarize={summarize} onOpenChat={openChat} />
          : <TranscriptTab />}
      </div>
    </div>
  )
}

// A Popover trigger needs a real button to hand focus back to, so this is Btn's small
// outline shape rather than Btn itself.
const outlineBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 'var(--radius)', cursor: 'pointer',
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)',
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} aria-label="Back to meetings" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
      <ArrowLeft size={16} />
    </button>
  )
}

function DownloadLine() {
  const download = useMeetingsStore(s => s.download)
  const selector = useMeetingsStore(s => s.selected)
  if (!download || !selector) return null
  switch (download.state) {
    case 'preparing': return <p role="status" className="text-xs" style={{ color: 'var(--text-secondary)' }}>Preparing download…</p>
    case 'saved': return <p role="status" className="text-xs" style={{ color: toneColor('done') }}>Saved to {download.path}</p>
    case 'downloaded': return <p role="status" className="text-xs" style={{ color: toneColor('done') }}>Downloaded {download.filename}</p>
    case 'failed': return <p role="status" className="text-xs" style={{ color: 'var(--danger)' }}>Download failed. No partial file was saved. Try again.</p>
    case 'tooLarge':
      return (
        <div className="text-xs px-2.5 py-2 rounded flex flex-col gap-1.5" style={{ background: toneTint('failed', 10), color: 'var(--text-primary)' }}>
          <span>This transcript is over 4 MB, so it can&apos;t be downloaded from the app. On the gateway host, run:</span>
          <CommandHint command={tooLargeCommand(selector)} lead="" />
        </div>
      )
  }
}

function SummaryTab({ summary, summarizing, canSummarize, onSummarize, onOpenChat }: {
  summary?: StoredSummary
  summarizing: { convId: string; slow: boolean } | null
  canSummarize: boolean
  onSummarize: () => void
  onOpenChat: (convId: string) => void
}) {
  if (!summary) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {summarizing ? (
          summarizing.slow ? (
            <p>The summary is taking longer than expected. <button onClick={() => onOpenChat(summarizing.convId)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer' }}>Open chat</button></p>
          ) : <p style={{ color: toneColor('working') }}>Summarizing…</p>
        ) : (
          <>
            <p>No summary yet.</p>
            {canSummarize && <Btn size="sm" variant="outline" icon={<Sparkles size={12} />} onClick={onSummarize}>Summarize</Btn>}
          </>
        )}
      </div>
    )
  }
  if (!summaryHasStructure(summary)) {
    return <div className="text-sm"><MarkdownContent text={summary.markdown} /></div>
  }
  const lists: [string, string[]][] = [
    ['Decisions', summary.decisions],
    ['Action items', summary.actionItems],
    ['Risks', summary.risks],
    ['Participants', summary.participants],
  ]
  return (
    <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--text-primary)' }}>
      {summary.overview.trim() && <p style={{ lineHeight: 1.55 }}>{summary.overview}</p>}
      {lists.filter(([, items]) => items.length > 0).map(([label, items]) => (
        <section key={label}>
          <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {items.map((item, i) => <li key={i} style={{ lineHeight: 1.5 }}>{item}</li>)}
          </ul>
        </section>
      ))}
      {summary.source === 'model' && (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Model-generated notes · check the transcript before relying on decisions or action items.</p>
      )}
      {summary.source === 'heuristic' && (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Notes extracted from the text, without a model.</p>
      )}
    </div>
  )
}

function TranscriptTab() {
  const { utterances, utteranceCursor, utteranceState, utteranceQuery, loadUtterances, setUtteranceQuery } = useMeetingsStore()
  const [draft, setDraft] = useState(utteranceQuery)
  useEffect(() => {
    if (draft === utteranceQuery) return
    const t = setTimeout(() => setUtteranceQuery(draft), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  const searching = !!utteranceQuery.trim()

  return (
    <div className="flex flex-col gap-2">
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Search this transcript" aria-label="Search this transcript"
          onKeyDown={e => { if (e.key === 'Enter') setUtteranceQuery(draft) }}
          style={{ width: '100%', padding: '5px 10px 5px 28px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }} />
      </div>
      {searching && utteranceState === 'ready' && (
        <p className="text-xs" role="status" aria-live="polite" style={{ color: 'var(--text-secondary)' }}>
          {utterances.length}{utteranceCursor ? '+' : ''} {utterances.length === 1 ? 'match' : 'matches'}
        </p>
      )}
      {utteranceState === 'loading' && <ReaderSkeleton compact />}
      {utteranceState === 'error' && <p className="text-xs" style={{ color: 'var(--danger)' }}>Couldn&apos;t load the transcript. <button onClick={() => void loadUtterances()} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer' }}>Try again</button></p>}
      {utteranceState === 'ready' && utterances.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {searching ? `No lines match “${utteranceQuery.trim()}”.` : 'Nothing was said, or captions were off.'}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        {utterances.map(u => <UtteranceLine key={`${u.sequence}-${u.id ?? ''}`} u={u} />)}
      </div>
      {utteranceCursor && (
        <div className="flex justify-center py-1">
          <Btn size="sm" variant="outline" onClick={() => void loadUtterances(true)}>Load more</Btn>
        </div>
      )}
    </div>
  )
}

function UtteranceLine({ u }: { u: Utterance }) {
  const time = u.startedAt ? new Date(u.startedAt) : null
  const at = time && !Number.isNaN(time.getTime()) ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <p className="text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
      {u.speakerLabel && <strong>{u.speakerLabel}</strong>}
      {u.speakerLabel && at && <span style={{ color: 'var(--text-secondary)' }}> · </span>}
      {at && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{at}</span>}
      {(u.speakerLabel || at) && <br />}
      {u.text}
    </p>
  )
}

function ReaderSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 ${compact ? '' : 'p-4'}`} aria-hidden>
      {[70, 45, 90, 80, 60].map((w, i) => (
        <div key={i} className="animate-pulse" style={{ height: 10, width: `${w}%`, borderRadius: 4, background: 'var(--bg-elevated)' }} />
      ))}
    </div>
  )
}

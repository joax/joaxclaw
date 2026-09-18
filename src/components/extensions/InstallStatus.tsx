import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { usePluginCatalogStore } from '../../store/pluginCatalog'
import { runStatusLine } from '../../lib/pluginInstall'
import { toneColor, toneTint } from '../../lib/stateTone'
import { Btn } from '../ui/Btn'

// Where an install is at, shown inline wherever it was started (the Browse pane, the
// channel form, Meetings setup). `origin` picks out this caller's run, so the channel
// form doesn't report an install started from Browse. `action` is an extra button for
// the finished state, such as Configure.
export function InstallStatus({ origin, action }: { origin: string; action?: ReactNode }) {
  const run = usePluginCatalogStore(s => (s.run?.target.origin === origin ? s.run : null))
  const retryRun = usePluginCatalogStore(s => s.retryRun)
  if (!run) return null
  const line = runStatusLine(run)
  if (!line) return null
  const color = toneColor(line.tone)
  const Icon = line.tone === 'working' ? Loader2 : line.tone === 'done' ? CheckCircle2 : line.tone === 'failed' ? XCircle : AlertCircle
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 px-2.5 py-2 rounded text-xs"
      style={{ background: toneTint(line.tone, 8), border: `1px solid ${toneTint(line.tone, 30)}`, color: 'var(--text-primary)', lineHeight: 1.5 }}
    >
      <Icon size={13} className={line.tone === 'working' ? 'animate-spin' : undefined} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        {line.text}
        {run.phase === 'done' && run.warnings?.map(w => (
          <span key={w} className="block mt-1" style={{ color: 'var(--text-secondary)' }}>{w}</span>
        ))}
      </span>
      {line.retry && <Btn size="sm" variant="outline" onClick={() => void retryRun()}>Try again</Btn>}
      {run.phase === 'done' && action}
    </div>
  )
}

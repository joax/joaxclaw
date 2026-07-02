import { useEffect, useState } from 'react'
import { Puzzle, X, Loader2, Wrench } from 'lucide-react'
import { useExtensionsStore } from '../../store/extensions'
import { usePluginUpdateStore } from '../../store/pluginUpdate'
import { PLUGIN_ID, isUpdateAvailable, startPluginUpdate } from '../../lib/pluginUpdate'
import { Btn } from '../ui/Btn'

// Slim, dismissible banner (mirrors the app UpdateBanner) shown when a newer joaxclaw-fs
// plugin is published on npm than the one installed on the gateway. "Update" runs the
// agent-driven force-reinstall + restart in a chat; Skip suppresses this version.
export function PluginUpdateBanner({ onOpenChat }: { onOpenChat?: () => void }) {
  const installed = useExtensionsStore(s => s.plugins.find(p => p.id === PLUGIN_ID)?.version)
  const { latest, skipped, dismissed, check, skip, dismiss } = usePluginUpdateStore()
  const [working, setWorking] = useState(false)

  useEffect(() => { check() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const offer = isUpdateAvailable(installed, latest ?? undefined) && !dismissed && skipped !== latest
  if (!offer) return null

  const update = async () => { setWorking(true); await startPluginUpdate(onOpenChat); setWorking(false) }

  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 26, height: 26, background: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}>
        <Puzzle size={14} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          <b>joaxclaw-fs v{latest}</b> is available.
          <span style={{ color: 'var(--text-secondary)' }}> The gateway has v{installed}.</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Btn size="sm" loading={working} icon={working ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} onClick={update}>
          Update via agent
        </Btn>
        <button onClick={skip} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-secondary)', background: 'transparent' }} title={`Skip v${latest} — don't remind me until the next release`}>
          Skip
        </button>
        <button onClick={dismiss} className="flex items-center justify-center rounded" style={{ width: 24, height: 24, color: 'var(--text-secondary)' }} title="Dismiss">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

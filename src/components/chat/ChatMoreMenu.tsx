import { useState } from 'react'
import { MoreHorizontal, Download, Copy, Share2, Loader2, Check } from 'lucide-react'
import { Popover, MenuRow } from '../ui/Popover'
import { useIsNarrow } from '../../lib/useIsNarrow'
import { canShareFiles } from '../../lib/saveFile'
import { hasExportableMessages, renderExport } from '../../lib/chatExport'
import { readFullHistory } from '../../lib/chatHistoryReader'
import { useConnectionStore } from '../../store/connection'
import { useChatExportStore } from '../../store/chatExport'
import { copyText, exportMetaFor } from './ExportChatDialog'

// The ⋯ menu at the end of the chat header (PRD 05): the chat's own actions that aren't
// settings. For now Export chat… (Share… on a phone that can share files) and Copy as
// Markdown. Hidden for a new chat, which has nothing on the gateway to read yet.

type CopyState = 'idle' | 'busy' | 'done' | 'failed' | 'blocked'

export function ChatMoreMenu({ sessionKey, title, empty }: {
  sessionKey?: string
  title: string
  /** The open chat has no messages. */
  empty: boolean
}) {
  const narrow = useIsNarrow()
  const online = useConnectionStore(s => s.status === 'connected')
  const openExport = useChatExportStore(s => s.open)
  const [open, setOpen] = useState(false)
  const [copy, setCopy] = useState<CopyState>('idle')
  if (!sessionKey) return null

  const disabledWhy = !online ? 'Connect to the gateway to export' : empty ? 'This chat has no messages yet' : undefined
  const share = narrow && canShareFiles()

  // Copy reads the whole chat with the saved options, without the dialog. The menu stays
  // open until the result has shown, so the outcome isn't lost.
  const copyMarkdown = async () => {
    if (copy === 'busy') return
    setCopy('busy')
    let next: CopyState = 'failed'
    try {
      const history = await readFullHistory(sessionKey)
      if (hasExportableMessages(history.raw)) {
        const prefs = useChatExportStore.getState().prefs
        next = await copyText(renderExport(history, exportMetaFor({ sessionKey, title }), 'md', prefs)) ? 'done' : 'blocked'
      }
    } catch { /* shown as "Couldn't read the chat" */ }
    setCopy(next)
    setTimeout(() => { setCopy('idle'); setOpen(false) }, next === 'done' ? 1500 : 3000)
  }

  const iconSize = narrow ? 16 : 13
  return (
    <Popover
      open={open}
      onOpenChange={o => { if (copy !== 'busy') setOpen(o) }}
      align="right"
      title="More"
      width={200}
      trigger={props => (
        <button
          {...props}
          aria-label="More"
          title="More"
          className="flex items-center justify-center rounded transition-colors"
          style={narrow
            ? { width: 30, height: 30, border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }
            : { width: 26, height: 26, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
        >
          <MoreHorizontal size={iconSize} />
        </button>
      )}
    >
      <div title={disabledWhy}>
        <MenuRow
          icon={share ? <Share2 size={13} /> : <Download size={13} />}
          disabled={!!disabledWhy}
          onClick={() => { setOpen(false); openExport({ sessionKey, title }) }}
        >
          {share ? 'Share…' : 'Export chat…'}
        </MenuRow>
        <MenuRow
          icon={copy === 'busy' ? <Loader2 size={13} className="animate-spin" /> : copy === 'done' ? <Check size={13} /> : <Copy size={13} />}
          disabled={!!disabledWhy}
          danger={copy === 'failed' || copy === 'blocked'}
          onClick={() => void copyMarkdown()}
        >
          <span aria-live="polite">
            {copy === 'busy' ? 'Copying…' : copy === 'done' ? 'Copied' : copy === 'failed' ? "Couldn't read the chat"
              : copy === 'blocked' ? "Couldn't copy. Use Save instead." : 'Copy as Markdown'}
          </span>
        </MenuRow>
      </div>
    </Popover>
  )
}

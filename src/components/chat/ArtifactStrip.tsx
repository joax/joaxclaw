import { useState } from 'react'
import { Download, ExternalLink, Loader2 } from 'lucide-react'
import type { Artifact } from '../../lib/artifacts'
import { fmtBytes } from '../../lib/artifacts'
import { saveHostFileAs } from '../../lib/fileContent'
import { popOutFile } from '../../lib/filePopout'
import { useFilesStore } from '../../store/files'
import { FileGlyph } from '../files/FilePreview'

// The files a turn produced, as cards under the message. This is the provenance half of
// the Files feature: on a remote gateway the agent's "I saved it to ~/report.md" is
// otherwise a dead end, because the file is on the host's disk. Clicking opens the
// viewer; the drawer (Files panel) is the same content, listed independently of chat.
//
// Rendered from the message's tool calls, NOT from the tool-call cards — so the files
// stay visible in Basic mode, where the technical trail is hidden.

export function ArtifactStrip({ artifacts }: { artifacts: Artifact[] }) {
  if (!artifacts.length) return null
  return (
    <div className="flex flex-col gap-1 mb-2">
      {artifacts.map(a => <ArtifactCard key={a.path} artifact={a} />)}
    </div>
  )
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const openFile = useFilesStore(s => s.openFile)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSaving(true); setNote('')
    const res = await saveHostFileAs(artifact.path, artifact.name)
    setSaving(false)
    if (res.canceled) return
    setNote(res.ok ? 'Saved' : (res.error ?? 'Could not save'))
    setTimeout(() => setNote(''), 2600)
  }

  const meta = [
    artifact.chars != null ? fmtBytes(artifact.chars) : '',
    artifact.inferred ? 'from a shell command' : '',
  ].filter(Boolean).join(' · ')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openFile({ path: artifact.path, name: artifact.name })}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile({ path: artifact.path, name: artifact.name }) } }}
      className="flex items-center gap-2 px-2.5 py-2"
      style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        background: 'var(--bg-surface)', cursor: 'pointer', maxWidth: 420,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent) 45%, var(--border))' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
      title={artifact.path}
    >
      <FileGlyph path={artifact.path} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{artifact.name}</div>
        <div className="truncate" style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
          {meta || artifact.path}
        </div>
      </div>
      {note && <span className="text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>{note}</span>}
      <button
        title="Open in its own window"
        onClick={e => { e.stopPropagation(); popOutFile(artifact.path, artifact.name) }}
        className="flex items-center justify-center shrink-0"
        style={{ width: 24, height: 24, borderRadius: 5, border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
      >
        <ExternalLink size={12} />
      </button>
      <button
        title="Save a copy to this machine"
        onClick={handleSave}
        className="flex items-center justify-center shrink-0"
        style={{ width: 24, height: 24, borderRadius: 5, border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      </button>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Music, Cloud } from 'lucide-react'
import type { MediaAttachment } from '../../lib/types'

interface Props {
  attachment: MediaAttachment
  accentColor?: boolean
}

// ── Source detection ──────────────────────────────────────────────────────────

type AudioSource = 'obsidian' | 'gdrive' | 'dropbox' | 'remote' | 'local'

function detectSource(url: string | undefined, name: string | undefined): AudioSource {
  const target = url ?? name ?? ''
  if (/obsidian|\.obsidian|vault-/i.test(target)) return 'obsidian'
  if (/drive\.google\.com|googleapis\.com\/drive|docs\.google\.com/i.test(target)) return 'gdrive'
  if (/dropbox\.com/i.test(target)) return 'dropbox'
  if (/^https?:\/\//i.test(target)) return 'remote'
  return 'local'
}

function formatExt(url: string | undefined, mediaType: string | undefined): string | null {
  if (url) {
    const m = url.match(/\.([a-zA-Z0-9]+)(\?|$)/)
    if (m) return m[1].toUpperCase()
  }
  if (mediaType) {
    const m = mediaType.match(/\/([a-zA-Z0-9]+)/)
    if (m) return m[1].toUpperCase()
  }
  return null
}

function displayName(name: string | undefined, url: string | undefined): string {
  if (name) return name
  if (url) {
    const raw = url.replace(/^file:\/\//, '').split('?')[0]
    return raw.split('/').pop() ?? raw
  }
  return 'Audio'
}

// ── Source icons ──────────────────────────────────────────────────────────────

function ObsidianIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 64 64" fill="none" style={{ flexShrink: 0 }}>
      {/* Outer shield / gem body */}
      <path d="M32 4 L54 16 L54 44 L32 60 L10 44 L10 16 Z" fill="#7C3AED" />
      {/* Inner facet highlight */}
      <path d="M32 12 L46 20 L46 42 L32 52 L18 42 L18 20 Z" fill="#A78BFA" opacity="0.55" />
      {/* Top-left facet */}
      <path d="M32 4 L10 16 L18 20 L32 12 Z" fill="#6D28D9" />
      {/* Bottom shine */}
      <path d="M32 36 L42 42 L32 52 L22 42 Z" fill="white" opacity="0.2" />
    </svg>
  )
}

function GDriveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 87 75" fill="none" style={{ flexShrink: 0 }}>
      {/* Yellow — bottom bar */}
      <polygon points="0,75 29,75 58,25 29,25" fill="#FBBC04" />
      {/* Blue — left wing */}
      <polygon points="0,75 29,25 14,0" fill="#4285F4" />
      {/* Green — right wing */}
      <polygon points="29,25 58,75 87,75 58,25" fill="#34A853" />
      {/* Slightly transparent top */}
      <polygon points="14,0 43,50 58,25 29,25" fill="#34A853" opacity="0.7" />
      <polygon points="14,0 43,50 29,25" fill="#4285F4" opacity="0.7" />
      <polygon points="14,0 72,0 58,25 29,25" fill="#EA4335" opacity="0.85" />
    </svg>
  )
}

function DropboxIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 40 40" fill="none" style={{ flexShrink: 0 }}>
      <polygon points="10,4 20,12 30,4 20,12" fill="#0061FF" />
      <polygon points="0,12 10,20 20,12 10,4" fill="#0061FF" />
      <polygon points="20,12 30,20 40,12 30,4" fill="#0061FF" />
      <polygon points="10,20 20,28 30,20 20,12" fill="#0061FF" />
      <polygon points="20,28 30,20 40,28 30,36" fill="#0061FF" />
      <polygon points="0,28 10,20 20,28 10,36" fill="#0061FF" />
    </svg>
  )
}

function SourceBadge({ source }: { source: AudioSource }) {
  if (source === 'obsidian') {
    return (
      <span
        className="flex items-center gap-1"
        title="Obsidian vault"
        style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          background: 'color-mix(in srgb, #7C3AED 12%, transparent)',
          border: '1px solid color-mix(in srgb, #7C3AED 30%, transparent)',
          color: '#A78BFA',
        }}
      >
        <ObsidianIcon />
        <span>Obsidian</span>
      </span>
    )
  }
  if (source === 'gdrive') {
    return (
      <span
        className="flex items-center gap-1"
        title="Google Drive"
        style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          background: 'color-mix(in srgb, #4285F4 10%, transparent)',
          border: '1px solid color-mix(in srgb, #4285F4 25%, transparent)',
          color: '#4285F4',
        }}
      >
        <GDriveIcon />
        <span>Drive</span>
      </span>
    )
  }
  if (source === 'dropbox') {
    return (
      <span
        className="flex items-center gap-1"
        title="Dropbox"
        style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          background: 'color-mix(in srgb, #0061FF 10%, transparent)',
          border: '1px solid color-mix(in srgb, #0061FF 25%, transparent)',
          color: '#0061FF',
        }}
      >
        <DropboxIcon />
        <span>Dropbox</span>
      </span>
    )
  }
  if (source === 'remote') {
    return (
      <span
        className="flex items-center gap-1"
        title="Remote URL"
        style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          background: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--text-secondary) 20%, transparent)',
          color: 'var(--text-secondary)',
        }}
      >
        <Cloud size={9} />
        <span>Remote</span>
      </span>
    )
  }
  return null
}

// ── Player ────────────────────────────────────────────────────────────────────

export function AudioPlayer({ attachment, accentColor }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)

  const source = detectSource(attachment.url, attachment.name)
  const ext = formatExt(attachment.url, attachment.mediaType)
  const title = displayName(attachment.name, attachment.url)

  useEffect(() => {
    if (attachment.url?.startsWith('file://')) {
      const localPath = attachment.url.slice('file://'.length)
      const api = (window as unknown as { api?: { file?: { readBinary?: (p: string) => Promise<{ ok: boolean; dataUrl?: string }> } } }).api
      api?.file?.readBinary?.(localPath)?.then(res => {
        if (res.ok && res.dataUrl) setSrcUrl(res.dataUrl)
      })
      return
    }
    if (attachment.url) { setSrcUrl(attachment.url); return }
    if (attachment.data) {
      const mime = attachment.mediaType ?? 'audio/ogg'
      const bytes = atob(attachment.data)
      const arr = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
      const blob = new Blob([arr], { type: mime })
      const url = URL.createObjectURL(blob)
      setSrcUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [attachment.url, attachment.data, attachment.mediaType])

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    playing ? el.pause() : el.play()
  }

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current
    if (!el || !el.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * el.duration
  }

  const fmt = (s: number) => {
    if (!isFinite(s)) return '—'
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  const fg = accentColor ? 'var(--accent-fg)' : 'var(--text-primary)'
  const fgDim = accentColor ? 'rgba(255,255,255,0.6)' : 'var(--text-secondary)'
  const trackBg = accentColor ? 'rgba(255,255,255,0.25)' : 'var(--border)'
  const fillBg = accentColor ? 'rgba(255,255,255,0.85)' : 'var(--accent)'
  const containerBg = accentColor ? 'rgba(255,255,255,0.08)' : 'var(--bg-elevated)'
  const containerBorder = accentColor ? 'rgba(255,255,255,0.15)' : 'var(--border)'

  if (!srcUrl) return null

  return (
    <div
      className="flex flex-col gap-1.5 mt-2"
      style={{
        minWidth: 240, maxWidth: 380,
        background: containerBg,
        border: `1px solid ${containerBorder}`,
        borderRadius: 'var(--radius)',
        padding: '8px 10px',
      }}
    >
      <audio
        ref={audioRef}
        src={srcUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={() => {
          const el = audioRef.current
          if (el?.duration) setProgress(el.currentTime / el.duration)
        }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        preload="metadata"
        style={{ display: 'none' }}
      />

      {/* ── Header: icon + filename + format + source badge ── */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Music size={11} style={{ color: fgDim, flexShrink: 0 }} />
        <span
          title={title}
          style={{ fontSize: 11, fontWeight: 500, color: fg, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {title}
        </span>
        {ext && (
          <span style={{
            fontSize: 8, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
            background: accentColor ? 'rgba(255,255,255,0.15)' : 'var(--bg-primary)',
            border: `1px solid ${containerBorder}`,
            color: fgDim, fontFamily: 'monospace', fontWeight: 600,
          }}>
            {ext}
          </span>
        )}
        <SourceBadge source={source} />
      </div>

      {/* ── Controls: play + scrubber + time ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={togglePlay}
          style={{
            width: 26, height: 26, borderRadius: '50%',
            border: 'none', background: fillBg,
            color: accentColor ? 'var(--accent)' : 'var(--accent-fg)',
            cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {playing ? <Pause size={11} /> : <Play size={11} style={{ marginLeft: 1 }} />}
        </button>

        {/* Scrubber */}
        <div
          className="flex-1 relative cursor-pointer"
          style={{ height: 4, background: trackBg, borderRadius: 2 }}
          onClick={handleScrub}
        >
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${progress * 100}%`,
            background: fillBg, borderRadius: 2, transition: 'width 0.1s',
          }} />
          {/* Thumb */}
          <div style={{
            position: 'absolute', top: '50%', left: `${progress * 100}%`,
            transform: 'translate(-50%, -50%)',
            width: 10, height: 10, borderRadius: '50%',
            background: fillBg, boxShadow: '0 0 0 2px var(--bg-elevated)',
            opacity: playing ? 1 : 0.6, transition: 'left 0.1s',
          }} />
        </div>

        <span style={{ fontSize: 10, color: fgDim, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', flexShrink: 0 }}>
          {duration > 0 ? `${fmt(progress * duration)} / ${fmt(duration)}` : '—'}
        </span>
      </div>
    </div>
  )
}

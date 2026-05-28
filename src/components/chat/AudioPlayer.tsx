import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Volume2 } from 'lucide-react'
import type { MediaAttachment } from '../../lib/types'

interface Props {
  attachment: MediaAttachment
  accentColor?: boolean
}

export function AudioPlayer({ attachment, accentColor }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)

  // Build src: prefer URL, fall back to blob from base64
  useEffect(() => {
    if (attachment.url) {
      setSrcUrl(attachment.url)
      return
    }
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
    if (playing) { el.pause() } else { el.play() }
  }

  const handleTimeUpdate = () => {
    const el = audioRef.current
    if (!el || !el.duration) return
    setProgress(el.currentTime / el.duration)
  }

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current
    if (!el || !el.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    el.currentTime = ratio * el.duration
    setProgress(ratio)
  }

  const fmt = (s: number) => {
    if (!isFinite(s)) return '—'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const fg = accentColor ? 'var(--accent-fg)' : 'var(--text-primary)'
  const fgDim = accentColor ? 'rgba(255,255,255,0.6)' : 'var(--text-secondary)'
  const trackBg = accentColor ? 'rgba(255,255,255,0.25)' : 'var(--border)'
  const fillBg = accentColor ? 'rgba(255,255,255,0.85)' : 'var(--accent)'

  if (!srcUrl) return null

  return (
    <div className="flex items-center gap-2 mt-2" style={{ minWidth: 220, maxWidth: 320 }}>
      <audio
        ref={audioRef}
        src={srcUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        preload="metadata"
        style={{ display: 'none' }}
      />

      <button
        onClick={togglePlay}
        style={{
          width: 30, height: 30, borderRadius: '50%',
          border: 'none', background: fillBg, color: accentColor ? 'var(--accent)' : 'var(--accent-fg)',
          cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
      >
        {playing ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
      </button>

      <Volume2 size={12} style={{ color: fgDim, flexShrink: 0 }} />

      <div
        className="flex-1 relative cursor-pointer"
        style={{ height: 4, background: trackBg, borderRadius: 2 }}
        onClick={handleScrub}
      >
        <div
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${progress * 100}%`,
            background: fillBg, borderRadius: 2, transition: 'width 0.1s'
          }}
        />
      </div>

      <span style={{ fontSize: 11, color: fgDim, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', flexShrink: 0 }}>
        {duration > 0 ? fmt(progress * duration) + ' / ' + fmt(duration) : '—'}
      </span>

      {attachment.name && (
        <span style={{ fontSize: 10, color: fgDim, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {attachment.name}
        </span>
      )}
    </div>
  )
}

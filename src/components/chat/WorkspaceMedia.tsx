import { useState, useEffect, useCallback } from 'react'
import { ZoomIn, X, Download, FileVideo, FileImage, AlertCircle } from 'lucide-react'

// ── Path → file:// URL ────────────────────────────────────────────────────────

function getHomedir(): string {
  const api = (window as unknown as { api?: { system?: { homedir?: string } } }).api
  return api?.system?.homedir ?? '~'
}

export function toFileUrl(src: string): string {
  if (!src) return src
  if (src.startsWith('file://') || src.startsWith('data:') || src.startsWith('blob:') ||
      src.startsWith('http://') || src.startsWith('https://')) return src
  if (src.startsWith('~/')) return 'file://' + getHomedir() + src.slice(1)
  if (src.startsWith('/')) return 'file://' + src
  return src  // relative — caller should resolve via file:find
}

function isRelativePath(src: string): boolean {
  return Boolean(src) &&
    !src.startsWith('/') && !src.startsWith('~/') &&
    !src.startsWith('file://') && !src.startsWith('data:') &&
    !src.startsWith('blob:') && !src.startsWith('http')
}

async function findFile(filename: string): Promise<string | null> {
  try {
    const api = (window as unknown as { api?: { file?: { find?: (f: string) => Promise<{ ok: boolean; path?: string }> } } }).api
    const res = await api?.file?.find?.(filename)
    return res?.ok && res.path ? res.path : null
  } catch {
    return null
  }
}

async function readBinary(filePath: string): Promise<string | null> {
  try {
    const api = (window as unknown as { api?: { file?: { readBinary?: (p: string) => Promise<{ ok: boolean; dataUrl?: string }> } } }).api
    const res = await api?.file?.readBinary?.(filePath)
    return res?.ok && res.dataUrl ? res.dataUrl : null
  } catch {
    return null
  }
}

// ── Extension sets ────────────────────────────────────────────────────────────

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)(\?[^\s]*)?$/i
export const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|ogv|m4v|3gp)(\?[^\s]*)?$/i

// ── WorkspaceImage ─────────────────────────────────────────────────────────────

interface WorkspaceImageProps {
  src: string
  alt?: string
}

function needsResolution(src: string): boolean {
  // Relative paths need find+readBinary; absolute local paths also need readBinary
  // to avoid Chromium's file:// cross-origin block in dev mode
  return Boolean(src) &&
    !src.startsWith('data:') && !src.startsWith('blob:') &&
    !src.startsWith('http://') && !src.startsWith('https://')
}

export function WorkspaceImage({ src, alt }: WorkspaceImageProps) {
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [resolving, setResolving] = useState(() => needsResolution(src))

  useEffect(() => {
    if (!needsResolution(src)) return
    setDataUrl(null)
    setError(false)
    setLoaded(false)
    setResolving(true)

    async function resolve() {
      let absPath: string | null = null
      if (isRelativePath(src)) {
        const filename = src.split('/').pop() ?? src
        absPath = await findFile(filename)
      } else {
        // absolute local path (starts with / or ~/ or file://)
        absPath = src.startsWith('file://') ? src.slice(7) : src.startsWith('~/') ? src.replace('~', getHomedir()) : src
      }
      if (!absPath) { setError(true); setResolving(false); return }
      const url = await readBinary(absPath)
      if (url) { setDataUrl(url); setResolving(false) }
      else { setError(true); setResolving(false) }
    }

    resolve()
  }, [src])

  const fileUrl = dataUrl ?? (needsResolution(src) ? null : src)
  const name = src.split('/').pop() ?? src

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setExpanded(false)
  }, [])

  useEffect(() => {
    if (expanded) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [expanded, handleKeyDown])

  if (resolving) {
    return (
      <span
        style={{
          display: 'block',
          width: 200,
          height: 120,
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          animation: 'pulse 1.5s ease-in-out infinite'
        }}
      />
    )
  }

  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono"
        style={{
          background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          color: 'var(--danger)'
        }}
        title={`Could not load: ${src}`}
      >
        <AlertCircle size={11} />
        <FileImage size={11} />
        {name}
      </span>
    )
  }

  return (
    <>
      <span
        className="inline-block my-2"
        style={{ maxWidth: '100%', display: 'block' }}
      >
        <span
          className="relative inline-block cursor-zoom-in group"
          onClick={() => setExpanded(true)}
          style={{ display: 'block', maxWidth: '100%' }}
        >
          <img
            src={fileUrl ?? ''}
            alt={alt ?? name}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            style={{
              maxHeight: 280,
              maxWidth: '100%',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              display: loaded ? 'block' : 'none',
              transition: 'opacity 0.15s'
            }}
          />
          {!loaded && !error && (
            <span
              style={{
                display: 'block',
                width: 200,
                height: 120,
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
                animation: 'pulse 1.5s ease-in-out infinite'
              }}
            />
          )}
          {loaded && (
            <span
              className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(0,0,0,0.6)', color: 'white', pointerEvents: 'none' }}
            >
              <ZoomIn size={13} />
            </span>
          )}
        </span>
        {alt && alt !== name && (
          <span className="block text-xs mt-1" style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            {alt}
          </span>
        )}
      </span>

      {expanded && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', top: 36 }}
          onClick={() => setExpanded(false)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <img
              src={fileUrl ?? ''}
              alt={alt ?? name}
              style={{ maxHeight: 'calc(100vh - 120px)', maxWidth: 'calc(100vw - 80px)', borderRadius: 'var(--radius)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
            />
            <div className="absolute top-2 right-2 flex gap-1.5">
              <a
                href={fileUrl ?? ''}
                download={name}
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: 'var(--radius)',
                  background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', cursor: 'pointer', textDecoration: 'none'
                }}
                title="Download"
              >
                <Download size={13} />
              </a>
              <button
                onClick={() => setExpanded(false)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: 'var(--radius)',
                  background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', cursor: 'pointer'
                }}
                title="Close (Esc)"
              >
                <X size={13} />
              </button>
            </div>
            <p className="text-center mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
              {name}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

// ── VideoPlayer ───────────────────────────────────────────────────────────────

interface VideoPlayerProps {
  src: string
  name?: string
}

export function VideoPlayer({ src, name }: VideoPlayerProps) {
  const [error, setError] = useState(false)
  const fileUrl = toFileUrl(src)
  const fileName = name ?? src.split('/').pop() ?? src

  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono"
        style={{
          background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          color: 'var(--danger)'
        }}
        title={`Could not load: ${src}`}
      >
        <AlertCircle size={11} />
        <FileVideo size={11} />
        {fileName}
      </span>
    )
  }

  return (
    <div className="my-2" style={{ maxWidth: '100%' }}>
      <video
        src={fileUrl}
        controls
        onError={() => setError(true)}
        style={{
          maxWidth: '100%',
          maxHeight: 320,
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: '#000',
          display: 'block'
        }}
      />
      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
        {fileName}
      </p>
    </div>
  )
}

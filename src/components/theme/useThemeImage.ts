import { useEffect, useState } from 'react'

// Load a theme background image from disk (userData) as a data URL, cached by path so
// switching themes back and forth doesn't re-read. Image bytes live only on disk + this
// in-memory cache — never in localStorage. Picking a new image writes a fresh unique
// filename (see the main-process pickImage handler), so a path never goes stale.
const cache = new Map<string, string>()

// Seed the cache after picking an image so the preview appears instantly (no re-read).
export function primeThemeImage(file: string, dataUrl: string): void {
  cache.set(file, dataUrl)
}

interface FileApi { readBinary?: (path: string) => Promise<{ ok: boolean; dataUrl?: string }> }

// Bundled preset assets (`asset:<url>`) and data/blob/http URLs render directly; only a
// user-picked image sitting on disk needs to be read through IPC as a data URL.
function directUrl(file?: string): string | null {
  if (!file) return null
  if (file.startsWith('asset:')) return file.slice(6)
  if (/^(data:|blob:|https?:)/.test(file)) return file
  return null
}

export function useThemeImage(file: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => directUrl(file) ?? (file ? cache.get(file) ?? null : null))

  useEffect(() => {
    if (!file) { setUrl(null); return }
    const direct = directUrl(file)
    if (direct) { setUrl(direct); return }
    const cached = cache.get(file)
    if (cached) { setUrl(cached); return }
    let cancelled = false
    const api = (window as unknown as { api?: { file?: FileApi } }).api?.file
    api?.readBinary?.(file)
      .then(res => {
        if (cancelled) return
        if (res?.ok && res.dataUrl) { cache.set(file, res.dataUrl); setUrl(res.dataUrl) }
        else setUrl(null)
      })
      .catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true }
  }, [file])

  return url
}

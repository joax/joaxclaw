// Putting bytes the app made (or read) onto the user's device. Under Electron it's the
// native Save dialog (the `file:saveAs` bridge); in the browser and the PWA it's a Blob
// download, and on a phone the share sheet when it can take files. Split out of
// fileContent's host-file Save As so chat export (PRD 05) can save text it built itself.

export interface SaveResult {
  ok: boolean
  canceled?: boolean
  /** Where the native dialog saved it. */
  path?: string
  /** No native dialog: it went to the browser's downloads. */
  downloaded?: boolean
  error?: string
}

export interface ShareResult extends SaveResult {
  shared?: boolean
  /** The user closed the share sheet: nothing to report. */
  aborted?: boolean
}

type NativeSaveAs = (name: string, base64: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>

/** What saving depends on, so the logic is testable outside a browser. */
export interface SaveDeps {
  saveAs?: NativeSaveAs
  download?: (name: string, bytes: Uint8Array, mediaType: string) => void
  canShare?: (data: { files: File[] }) => boolean
  share?: (data: { files: File[]; title?: string }) => Promise<void>
  makeFile?: (bytes: Uint8Array, name: string, mediaType: string) => File
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  // Chunked so a multi-MB file doesn't blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

// A fresh ArrayBuffer, so a Blob never sees a view over a larger buffer.
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function blobDownload(name: string, bytes: Uint8Array, mediaType: string): void {
  const url = URL.createObjectURL(new Blob([ownBuffer(bytes)], { type: mediaType }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function browserDeps(): SaveDeps {
  const w = typeof window !== 'undefined' ? window as unknown as { api?: { file?: { saveAs?: NativeSaveAs } } } : undefined
  const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean } : undefined
  return {
    saveAs: w?.api?.file?.saveAs,
    download: blobDownload,
    canShare: nav?.canShare ? d => { try { return nav.canShare!(d) } catch { return false } } : undefined,
    share: nav?.share ? d => nav.share(d) : undefined,
    makeFile: (bytes, name, mediaType) => new File([ownBuffer(bytes)], name, { type: mediaType }),
  }
}

/** Save through the native dialog when there is one, else as a download. */
export async function saveBytesAs(name: string, bytes: Uint8Array, mediaType: string, deps: SaveDeps = browserDeps()): Promise<SaveResult> {
  try {
    if (deps.saveAs) {
      const res = await deps.saveAs(name, bytesToB64(bytes))
      return { ok: !!res?.ok, canceled: res?.canceled, path: res?.path, error: res?.error }
    }
    deps.download?.(name, bytes, mediaType)
    return { ok: true, downloaded: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * The phone path: the share sheet when it takes files, else a download. Dismissing the
 * sheet is not an error and falls back to nothing; any other share failure falls back
 * to a download.
 */
export async function shareOrDownload(name: string, bytes: Uint8Array, mediaType: string, title: string, deps: SaveDeps = browserDeps()): Promise<ShareResult> {
  const file = deps.makeFile?.(bytes, name, mediaType)
  if (file && deps.share && deps.canShare?.({ files: [file] })) {
    try {
      await deps.share({ files: [file], title })
      return { ok: true, shared: true }
    } catch (e) {
      if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError') return { ok: false, aborted: true }
    }
  }
  try {
    deps.download?.(name, bytes, mediaType)
    return { ok: true, downloaded: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Whether this device's share sheet can take a file (the phone "Share…" entry). */
export function canShareFiles(deps: SaveDeps = browserDeps()): boolean {
  if (!deps.share || !deps.canShare || !deps.makeFile) return false
  try {
    return deps.canShare({ files: [deps.makeFile(new Uint8Array([35]), 'chat.md', 'text/markdown')] })
  } catch { return false }
}

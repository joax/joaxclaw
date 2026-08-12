// Reading a file that lives on the GATEWAY host, from wherever the app is running.
//
// LOCAL gateway  → the file is on this machine: Electron fs (file:read / file:readBinary).
// REMOTE gateway → the file is on the host, unreachable from local fs: read it over the
//   WS. Preferred path is the joaxclaw-fs `host.files.read` RPC (chunked, reports size);
//   older plugins fall back to `host.readMedia`, which returns the whole file as a data
//   URL and caps at 32 MB. See docs/files-drawer.md and the remote-gateway seam.
//
// Read-only by design — the models author these documents, the app views them.

import { gatewayClient } from './gateway'
import { isRemoteGatewayState } from '../store/connection'
import { isTextual, extOf } from './artifacts'

/** Bytes we're willing to pull for a preview. Bigger files are read truncated. */
export const PREVIEW_MAX_BYTES = 1024 * 1024
/** Bytes we're willing to pull for a Save As (the readMedia fallback caps at 32 MB). */
export const SAVE_MAX_BYTES = 32 * 1024 * 1024

export interface HostFile {
  ok: boolean
  /** Absolute path as resolved on the host, when it reported one. */
  path: string
  text?: string
  /** Populated for non-textual files (and always available for Save As). */
  bytes?: Uint8Array
  mediaType?: string
  size?: number
  truncated?: boolean
  error?: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

const isUnknownMethod = (e: unknown): boolean =>
  /unknown method/i.test(e instanceof Error ? e.message : String(e))

function homedir(): string {
  const api = (window as unknown as { api?: { system?: { homedir?: string } } }).api
  return api?.system?.homedir ?? '~'
}

const isRelativePath = (p: string): boolean =>
  Boolean(p) && !p.startsWith('/') && !p.startsWith('~/') && !p.startsWith('file://')

export function stripFileUrl(p: string): string {
  return p.startsWith('file://') ? p.slice(7) : p
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
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

/** UTF-8 aware — the workspace markdown these agents write is full of emoji. */
const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

function splitDataUrl(dataUrl: string): { mediaType: string; b64: string } {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return { mediaType: 'application/octet-stream', b64: '' }
  return { mediaType: m[1] || 'application/octet-stream', b64: m[3] ?? '' }
}

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', log: 'text/plain',
  csv: 'text/csv', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml',
  html: 'text/html', css: 'text/css', js: 'text/javascript', ts: 'text/plain',
  pdf: 'application/pdf', zip: 'application/zip',
}

export function guessMediaType(path: string): string {
  return MIME_BY_EXT[extOf(path)] ?? 'application/octet-stream'
}

// ── local (Electron) ──────────────────────────────────────────────────────────

interface FileApi {
  read?: (p: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  readBinary?: (p: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  find?: (f: string) => Promise<{ ok: boolean; path?: string }>
}
const fileApi = (): FileApi | undefined =>
  (window as unknown as { api?: { file?: FileApi } }).api?.file

async function resolveLocalPath(p: string): Promise<string | null> {
  const raw = stripFileUrl(p)
  if (isRelativePath(raw)) {
    const found = await fileApi()?.find?.(raw.split('/').pop() ?? raw)
    return found?.ok && found.path ? found.path : null
  }
  return raw.startsWith('~/') ? homedir() + raw.slice(1) : raw
}

async function readLocal(p: string): Promise<HostFile> {
  const abs = await resolveLocalPath(p)
  if (!abs) return { ok: false, path: p, error: 'File not found on this machine' }

  if (isTextual(abs)) {
    const res = await fileApi()?.read?.(abs)
    if (!res?.ok || res.text == null) return { ok: false, path: abs, error: res?.error ?? 'Could not read the file' }
    return { ok: true, path: abs, text: res.text, size: new Blob([res.text]).size, mediaType: guessMediaType(abs) }
  }

  const res = await fileApi()?.readBinary?.(abs)
  if (!res?.ok || !res.dataUrl) return { ok: false, path: abs, error: res?.error ?? 'Could not read the file' }
  const { mediaType, b64 } = splitDataUrl(res.dataUrl)
  const bytes = b64ToBytes(b64)
  return { ok: true, path: abs, bytes, mediaType, size: bytes.length }
}

// ── remote (gateway RPC) ──────────────────────────────────────────────────────

interface FilesReadResult { content?: string; size?: number; eof?: boolean; path?: string; mediaType?: string }

async function readRemote(p: string, maxBytes: number): Promise<HostFile> {
  const textual = isTextual(p)

  // Preferred: the chunked host.files.read (joaxclaw-fs ≥0.12.0). Reports the real
  // size, so we can tell "that's the whole file" from "we stopped at the cap".
  try {
    const r = await gatewayClient.request<FilesReadResult>('host.files.read', {
      path: p,
      encoding: textual ? 'utf8' : 'base64',
      offset: 0,
      length: maxBytes,
    })
    const size = r.size
    const truncated = r.eof === false
    if (textual) {
      return { ok: true, path: r.path ?? p, text: r.content ?? '', size, truncated, mediaType: r.mediaType ?? guessMediaType(p) }
    }
    const bytes = b64ToBytes(r.content ?? '')
    return { ok: true, path: r.path ?? p, bytes, size: size ?? bytes.length, truncated, mediaType: r.mediaType ?? guessMediaType(p) }
  } catch (e) {
    if (!isUnknownMethod(e)) {
      return { ok: false, path: p, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Fallback: host.readMedia (joaxclaw-fs ≥0.11.4) — whole file, 32 MB cap, and it
  // resolves a bare filename via a host-side find.
  try {
    const params = isRelativePath(p) ? { filename: p.split('/').pop() ?? p } : { path: p }
    const r = await gatewayClient.request<{ dataUrl?: string; path?: string; size?: number; mediaType?: string }>('host.readMedia', params)
    if (!r?.dataUrl) return { ok: false, path: p, error: 'The gateway returned no content' }
    const { b64 } = splitDataUrl(r.dataUrl)
    const bytes = b64ToBytes(b64)
    // readMedia types by extension and falls back to octet-stream, so for a .md it
    // reports a binary type. Trust our own extension mapping for textual files.
    const mediaType = isTextual(p) ? guessMediaType(p) : (r.mediaType ?? 'application/octet-stream')
    return {
      ok: true,
      path: r.path ?? p,
      size: r.size ?? bytes.length,
      mediaType,
      ...(textual ? { text: decodeUtf8(bytes) } : { bytes }),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      path: p,
      error: isUnknownMethod(e)
        ? 'The gateway host needs the joaxclaw-fs plugin to share files.'
        : msg,
    }
  }
}

/** Read a host file for preview or export. Never throws — failures come back as `ok:false`. */
export async function readHostFile(path: string, opts?: { maxBytes?: number }): Promise<HostFile> {
  const p = stripFileUrl(path)
  if (!p) return { ok: false, path, error: 'No path' }
  const maxBytes = opts?.maxBytes ?? PREVIEW_MAX_BYTES
  try {
    return isRemoteGatewayState() ? await readRemote(p, maxBytes) : await readLocal(p)
  } catch (e) {
    return { ok: false, path: p, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── export ────────────────────────────────────────────────────────────────────

interface SaveApi { saveAs?: (name: string, base64: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> }
const saveApi = (): SaveApi | undefined =>
  (window as unknown as { api?: { file?: SaveApi } }).api?.file

export interface SaveResult { ok: boolean; canceled?: boolean; path?: string; error?: string }

/**
 * Copy a host file to the user's machine. Under Electron that's a native Save dialog;
 * in the browser/PWA it's a Blob download to the browser's download folder.
 */
export async function saveHostFileAs(path: string, name?: string): Promise<SaveResult> {
  const file = await readHostFile(path, { maxBytes: SAVE_MAX_BYTES })
  if (!file.ok) return { ok: false, error: file.error ?? 'Could not read the file' }

  const bytes = file.bytes ?? new TextEncoder().encode(file.text ?? '')
  const filename = name || (file.path.split('/').pop() ?? 'download')

  const native = saveApi()?.saveAs
  if (native) {
    const res = await native(filename, bytesToB64(bytes))
    return { ok: !!res?.ok, canceled: res?.canceled, path: res?.path, error: res?.error }
  }

  // Browser / PWA: synthesize a download. Copy into a fresh ArrayBuffer so the Blob
  // never sees a view over a larger buffer.
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const blob = new Blob([copy.buffer], { type: file.mediaType ?? guessMediaType(path) })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { ok: true }
}

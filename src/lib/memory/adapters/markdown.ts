// Markdown-folder content adapter — a directory of .md files on the gateway host,
// read via the Electron file bridge. config = { path }. No graph (flat file list).

import type { MemoryAdapter, MemoryItem } from '../types'

type FileApi = {
  listdir: (dir: string, ext?: string) => Promise<{ ok: boolean; files?: { name: string; path: string }[]; error?: string }>
  read: (path: string) => Promise<{ ok: boolean; text?: string; error?: string }>
}
const fileApi = (): FileApi | undefined =>
  (window as unknown as { api?: { file?: FileApi } }).api?.file

export const markdownAdapter: MemoryAdapter = {
  async test(config) {
    const api = fileApi()
    if (!api) return { ok: false, error: 'File access is only available in the desktop app.' }
    const res = await api.listdir(config.path, '.md')
    if (!res.ok) return { ok: false, error: res.error ?? `Cannot read folder ${config.path}` }
    const n = res.files?.length ?? 0
    return { ok: true, info: { totalItems: n, note: `${n} markdown file${n === 1 ? '' : 's'}` } }
  },

  async list(config) {
    const api = fileApi()
    if (!api) return []
    const res = await api.listdir(config.path, '.md')
    return (res.files ?? [])
      .map<MemoryItem>(f => ({ id: f.path, title: f.name.replace(/\.md$/, '') }))
      .sort((a, b) => a.title.localeCompare(b.title))
  },

  async read(_config, id) {
    const api = fileApi()
    if (!api) throw new Error('File access is only available in the desktop app.')
    const res = await api.read(id)
    if (!res.ok) throw new Error(res.error ?? 'Cannot read file')
    return res.text ?? ''
  },
}

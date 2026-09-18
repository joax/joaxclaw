import { describe, it, expect } from 'vitest'
import { saveBytesAs, shareOrDownload, canShareFiles, bytesToB64, type SaveDeps } from '../saveFile'

// Saving what the app built (chat export): the Electron Save dialog when there is one,
// else a download; on a phone the share sheet when it takes files.

const bytes = new TextEncoder().encode('# Pricing research\n')
const fakeFile = (b: Uint8Array, name: string, type: string) => ({ name, type, size: b.length }) as unknown as File

function deps(over: Partial<SaveDeps> = {}) {
  const log: string[] = []
  const d: SaveDeps = {
    download: (name) => { log.push(`download:${name}`) },
    makeFile: fakeFile,
    ...over,
  }
  return { d, log }
}

describe('saveBytesAs', () => {
  it('uses the native dialog with base64 bytes', async () => {
    let got: [string, string] | undefined
    const { d, log } = deps({ saveAs: async (n, b64) => { got = [n, b64]; return { ok: true, path: '/home/u/Downloads/x.md' } } })
    expect(await saveBytesAs('x.md', bytes, 'text/markdown', d)).toEqual({ ok: true, canceled: undefined, path: '/home/u/Downloads/x.md', error: undefined })
    expect(got).toEqual(['x.md', bytesToB64(bytes)])
    expect(log).toEqual([])
  })

  it('reports a cancelled dialog and a save error', async () => {
    expect(await saveBytesAs('x.md', bytes, 'text/markdown', deps({ saveAs: async () => ({ ok: false, canceled: true }) }).d)).toMatchObject({ ok: false, canceled: true })
    expect(await saveBytesAs('x.md', bytes, 'text/markdown', deps({ saveAs: async () => ({ ok: false, error: 'EACCES' }) }).d)).toMatchObject({ ok: false, error: 'EACCES' })
  })

  it('falls back to a download without the bridge', async () => {
    const { d, log } = deps()
    expect(await saveBytesAs('x.md', bytes, 'text/markdown', d)).toEqual({ ok: true, downloaded: true })
    expect(log).toEqual(['download:x.md'])
  })
})

describe('shareOrDownload', () => {
  it('shares the file when the sheet can take it', async () => {
    let shared: { files: File[]; title?: string } | undefined
    const { d, log } = deps({ canShare: () => true, share: async data => { shared = data } })
    expect(await shareOrDownload('x.md', bytes, 'text/markdown', 'Pricing research', d)).toEqual({ ok: true, shared: true })
    expect(shared?.title).toBe('Pricing research')
    expect(shared?.files[0].name).toBe('x.md')
    expect(log).toEqual([])
  })

  it('does nothing when the user dismisses the sheet', async () => {
    const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' })
    const { d, log } = deps({ canShare: () => true, share: async () => { throw abort } })
    expect(await shareOrDownload('x.md', bytes, 'text/markdown', 't', d)).toEqual({ ok: false, aborted: true })
    expect(log).toEqual([])
  })

  it('downloads when sharing fails or files are not supported', async () => {
    const failing = deps({ canShare: () => true, share: async () => { throw new Error('NotAllowedError') } })
    expect(await shareOrDownload('x.md', bytes, 'text/markdown', 't', failing.d)).toEqual({ ok: true, downloaded: true })
    expect(failing.log).toEqual(['download:x.md'])
    const unsupported = deps({ canShare: () => false, share: async () => {} })
    expect(await shareOrDownload('x.md', bytes, 'text/markdown', 't', unsupported.d)).toEqual({ ok: true, downloaded: true })
  })
})

describe('canShareFiles', () => {
  it('needs share, canShare and a file that passes', () => {
    expect(canShareFiles(deps({ canShare: () => true, share: async () => {} }).d)).toBe(true)
    expect(canShareFiles(deps({ canShare: () => false, share: async () => {} }).d)).toBe(false)
    expect(canShareFiles(deps().d)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { b64ToBytes, bytesToB64, guessMediaType, stripFileUrl } from '../fileContent'
import { filePopoutQuery } from '../filePopout'
import { newSince, breadcrumbFor, type FileEntry } from '../../store/files'

// The base64 round-trip is load-bearing: on a remote gateway every byte of a shared
// file crosses the WS base64-encoded, and the workspace markdown these agents write is
// full of emoji — a latin1 decode would mangle it.

describe('base64 round-trip', () => {
  it('survives UTF-8 beyond the BMP', () => {
    const text = '# MEMORY 🧠✨\n— dash, ümlaut, 中文\n'
    const bytes = new TextEncoder().encode(text)
    expect(new TextDecoder().decode(b64ToBytes(bytesToB64(bytes)))).toBe(text)
  })

  it('handles empty and binary payloads', () => {
    expect(bytesToB64(new Uint8Array())).toBe('')
    const bin = new Uint8Array([0, 1, 2, 250, 251, 255])
    expect([...b64ToBytes(bytesToB64(bin))]).toEqual([...bin])
  })

  it('chunks large payloads without blowing the call stack', () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 256)
    expect([...b64ToBytes(bytesToB64(big))]).toEqual([...big])
  })
})

describe('guessMediaType', () => {
  it('types the textual families the viewer renders', () => {
    expect(guessMediaType('report.md')).toBe('text/markdown')
    expect(guessMediaType('data.json')).toBe('application/json')
    expect(guessMediaType('notes.txt')).toBe('text/plain')
  })

  it('falls back to a binary type', () => {
    expect(guessMediaType('thing.bin')).toBe('application/octet-stream')
    expect(guessMediaType('Makefile')).toBe('application/octet-stream')
  })
})

describe('stripFileUrl', () => {
  it('unwraps file:// but leaves plain paths alone', () => {
    expect(stripFileUrl('file:///home/u/a.md')).toBe('/home/u/a.md')
    expect(stripFileUrl('/home/u/a.md')).toBe('/home/u/a.md')
    expect(stripFileUrl('a.md')).toBe('a.md')
  })
})

describe('filePopoutQuery', () => {
  it('encodes the path so a space or & survives the round trip', () => {
    const q = filePopoutQuery('/home/u/my report & notes.md', 'my report & notes.md')
    const parsed = new URLSearchParams(q.slice(1))
    expect(parsed.get('popout')).toBe('file')
    expect(parsed.get('path')).toBe('/home/u/my report & notes.md')
    expect(parsed.get('name')).toBe('my report & notes.md')
  })

  it('omits the name when there isn\'t one', () => {
    expect(new URLSearchParams(filePopoutQuery('/a.md').slice(1)).get('name')).toBeNull()
  })
})

describe('newSince', () => {
  const entry = (over: Partial<FileEntry>): FileEntry =>
    ({ name: 'a.md', path: '/a.md', size: 1, mtimeMs: 0, isDir: false, ...over })

  it('picks files written after the last visit', () => {
    const entries = [
      entry({ path: '/new.md', mtimeMs: 200 }),
      entry({ path: '/old.md', mtimeMs: 50 }),
    ]
    expect(newSince(entries, 100).map(e => e.path)).toEqual(['/new.md'])
  })

  it('never marks directories new', () => {
    expect(newSince([entry({ path: '/d', mtimeMs: 200, isDir: true })], 100)).toEqual([])
  })

  it('marks nothing on a first visit, so an existing workspace does not all light up', () => {
    expect(newSince([entry({ mtimeMs: 200 })], 0)).toEqual([])
  })
})

describe('breadcrumbFor', () => {
  // Without a crumb back to the root, walking into a folder was a one-way trip on a
  // gateway with a single root (the root tabs only render when there are several).
  it('always offers a way back to the root', () => {
    expect(breadcrumbFor('Workspace', 'reports/2026')[0]).toEqual({ label: 'Workspace', subdir: '' })
  })

  it('builds a cumulative trail', () => {
    expect(breadcrumbFor('Workspace', 'reports/2026/q3')).toEqual([
      { label: 'Workspace', subdir: '' },
      { label: 'reports', subdir: 'reports' },
      { label: '2026', subdir: 'reports/2026' },
      { label: 'q3', subdir: 'reports/2026/q3' },
    ])
  })

  it('is just the root at the top level', () => {
    expect(breadcrumbFor('Workspace', '')).toEqual([{ label: 'Workspace', subdir: '' }])
  })

  it('ignores stray slashes', () => {
    expect(breadcrumbFor('Workspace', '/reports//2026/').map(c => c.subdir))
      .toEqual(['', 'reports', 'reports/2026'])
  })
})

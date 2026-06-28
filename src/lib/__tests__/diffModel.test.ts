import { describe, it, expect } from 'vitest'
import { rowsFromOldNew, rowsFromUnified, summarize, pairForSplit, langFromPath, extractResultDiff } from '../diffModel'

describe('rowsFromOldNew', () => {
  it('marks added / removed / context with correct line numbers', () => {
    const rows = rowsFromOldNew('a\nb\nc\n', 'a\nB\nc\n')
    expect(rows.map(r => `${r.type}:${r.text}`)).toEqual([
      'context:a', 'del:b', 'add:B', 'context:c',
    ])
    const del = rows.find(r => r.type === 'del')!
    const add = rows.find(r => r.type === 'add')!
    expect(del.oldNo).toBe(2)
    expect(add.newNo).toBe(2)
    expect(summarize(rows)).toEqual({ added: 1, removed: 1 })
  })

  it('handles a pure insertion', () => {
    const rows = rowsFromOldNew('a\nc\n', 'a\nb\nc\n')
    expect(summarize(rows)).toEqual({ added: 1, removed: 0 })
    expect(rows.find(r => r.type === 'add')!.text).toBe('b')
  })
})

describe('rowsFromUnified', () => {
  const patch = `--- a/src/util.ts\n+++ b/src/util.ts\n@@ -1,3 +1,3 @@\n const x = 1\n-const y = 2\n+const y = 3\n const z = 4\n`
  it('parses hunks into rows with numbers and recovers the path', () => {
    const { rows, path } = rowsFromUnified(patch)
    expect(path).toBe('src/util.ts')
    expect(rows.map(r => `${r.type}:${r.text}`)).toEqual([
      'context:const x = 1', 'del:const y = 2', 'add:const y = 3', 'context:const z = 4',
    ])
    expect(summarize(rows)).toEqual({ added: 1, removed: 1 })
    expect(rows.find(r => r.type === 'del')!.oldNo).toBe(2)
    expect(rows.find(r => r.type === 'add')!.newNo).toBe(2)
  })

  it('returns empty rows for non-diff garbage instead of throwing', () => {
    expect(rowsFromUnified('not a diff at all').rows).toEqual([])
  })
})

describe('pairForSplit', () => {
  it('zips a del-run with an add-run side by side', () => {
    const rows = rowsFromOldNew('a\nb\nc\n', 'a\nB\nC\nD\n')   // b,c → B,C,D
    const pairs = pairForSplit(rows)
    // context a, then (b|B),(c|C),(–|D)
    expect(pairs[0].left?.text).toBe('a')
    expect(pairs[0].right?.text).toBe('a')
    const changed = pairs.slice(1)
    expect(changed.map(p => [p.left?.text ?? '', p.right?.text ?? ''])).toEqual([
      ['b', 'B'], ['c', 'C'], ['', 'D'],
    ])
  })
})

describe('extractResultDiff', () => {
  // The exact shape an edit tool returns its result in (content + details.patch).
  const toolResult = JSON.stringify({
    content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in /repo/scripts/debug.ts.' }],
    details: {
      diff: '   5  * docs\n+  9 import x\n  10 ...',   // pretty/numbered — NOT a real unified diff
      patch: "--- /repo/scripts/debug.ts\n+++ /repo/scripts/debug.ts\n@@ -5,4 +5,5 @@\n  */\n \n+import 'dotenv/config';\n import { createClient } from '@x';\n \n",
      firstChangedLine: 9,
    },
  })

  it('pulls the unified patch out of a tool result and ignores the numbered diff field', () => {
    const diff = extractResultDiff(toolResult)
    expect(diff).not.toBeNull()
    expect(diff).toContain('@@ -5,4 +5,5 @@')
    const { rows, path } = rowsFromUnified(diff!)
    expect(path).toBe('/repo/scripts/debug.ts')
    expect(summarize(rows)).toEqual({ added: 1, removed: 0 })
  })

  it('returns null for a plain text / non-diff result', () => {
    expect(extractResultDiff('ok, done')).toBeNull()
    expect(extractResultDiff(JSON.stringify({ content: [{ text: 'no diff here' }] }))).toBeNull()
  })

  it('accepts a bare unified-diff string', () => {
    expect(extractResultDiff('--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n')).toContain('@@')
  })
})

describe('langFromPath', () => {
  it('maps extensions to refractor languages', () => {
    expect(langFromPath('src/a.tsx')).toBe('typescript')
    expect(langFromPath('x.py')).toBe('python')
    expect(langFromPath('deploy/Dockerfile')).toBe('docker')
    expect(langFromPath('styles.scss')).toBe('scss')
    expect(langFromPath('noext')).toBeUndefined()
    expect(langFromPath(undefined)).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import {
  extractArtifacts, isFileWriteTool, pathFromWriteArgs, pathsFromBashCommand,
  previewMode, isTextual, extOf, fmtBytes,
} from '../artifacts'
import type { ToolCall } from '../types'

// The artifact list is what tells the user "your report is at this path" on a remote
// gateway, so these lock the extraction against the tool vocabularies the backends use
// and against advertising files that were never written.

const call = (over: Partial<ToolCall> & { name: string }): ToolCall => ({
  id: over.id ?? 'tc-1',
  name: over.name,
  status: over.status ?? 'done',
  args: over.args,
  result: over.result,
})

describe('isFileWriteTool', () => {
  it('recognises the write vocabularies', () => {
    for (const n of ['Write', 'write_file', 'create_file', 'str_replace_editor', 'edit_file', 'patch_file', 'Edit'])
      expect(isFileWriteTool(n), n).toBe(true)
  })

  it('leaves reads and searches alone', () => {
    for (const n of ['Read', 'read_file', 'grep', 'web_search', 'Bash'])
      expect(isFileWriteTool(n), n).toBe(false)
  })
})

describe('pathFromWriteArgs', () => {
  it('accepts each arg name the backends use', () => {
    expect(pathFromWriteArgs('{"file_path":"/tmp/a.md"}')).toBe('/tmp/a.md')
    expect(pathFromWriteArgs('{"path":"/tmp/b.md"}')).toBe('/tmp/b.md')
    expect(pathFromWriteArgs('{"target_file":"/tmp/c.md"}')).toBe('/tmp/c.md')
    expect(pathFromWriteArgs('{"filename":"d.md"}')).toBe('d.md')
  })

  it('survives unparseable args', () => {
    expect(pathFromWriteArgs('not json')).toBe('')
    expect(pathFromWriteArgs(undefined)).toBe('')
  })
})

describe('pathsFromBashCommand', () => {
  it('catches heredoc and append redirects', () => {
    expect(pathsFromBashCommand("cat > report.md <<'EOF'")).toEqual(['report.md'])
    expect(pathsFromBashCommand('echo hi >> ~/notes/log.txt')).toEqual(['~/notes/log.txt'])
    expect(pathsFromBashCommand('python gen.py | tee out.csv')).toEqual(['out.csv'])
  })

  it('ignores fd redirects, /dev/null, and extensionless targets', () => {
    expect(pathsFromBashCommand('make 2>&1')).toEqual([])
    expect(pathsFromBashCommand('noisy > /dev/null')).toEqual([])
    expect(pathsFromBashCommand('cmd > outfile')).toEqual([])
  })
})

describe('extractArtifacts', () => {
  it('lifts a written file out of a turn', () => {
    const [a] = extractArtifacts([call({ name: 'Write', args: '{"file_path":"/home/u/report.md","content":"hello"}' })])
    expect(a).toMatchObject({ path: '/home/u/report.md', name: 'report.md', kind: 'file', chars: 5 })
  })

  it('skips calls that failed or are still running', () => {
    expect(extractArtifacts([
      call({ name: 'Write', status: 'error', args: '{"file_path":"/a.md"}' }),
      call({ name: 'Write', status: 'running', args: '{"file_path":"/b.md"}' }),
      call({ name: 'Write', status: 'pending', args: '{"file_path":"/c.md"}' }),
    ])).toEqual([])
  })

  it('collapses repeated edits into one entry, ordered by the last write', () => {
    const arts = extractArtifacts([
      call({ id: '1', name: 'Write', args: '{"file_path":"/a.md"}' }),
      call({ id: '2', name: 'Write', args: '{"file_path":"/b.md"}' }),
      call({ id: '3', name: 'Edit', args: '{"file_path":"/a.md"}' }),
    ])
    expect(arts.map(a => a.path)).toEqual(['/b.md', '/a.md'])
    expect(arts.find(a => a.path === '/a.md')?.toolCallId).toBe('3')
  })

  it('infers a path from a shell redirect and marks it inferred', () => {
    const [a] = extractArtifacts([call({ name: 'bash', args: '{"command":"cat > /tmp/out.md <<EOF"}' })])
    expect(a).toMatchObject({ path: '/tmp/out.md', inferred: true })
  })

  it('classifies media by extension', () => {
    const arts = extractArtifacts([
      call({ id: '1', name: 'Write', args: '{"file_path":"/x/chart.png"}' }),
      call({ id: '2', name: 'Write', args: '{"file_path":"/x/clip.mp4"}' }),
    ])
    expect(arts.map(a => a.kind)).toEqual(['image', 'video'])
  })

  it('is empty for a turn with no writes', () => {
    expect(extractArtifacts([call({ name: 'Read', args: '{"file_path":"/a.md"}' })])).toEqual([])
    expect(extractArtifacts(undefined)).toEqual([])
  })
})

describe('previewMode', () => {
  it('routes each family to its renderer', () => {
    expect(previewMode('notes.md')).toBe('markdown')
    expect(previewMode('main.ts')).toBe('code')
    expect(previewMode('run.log')).toBe('text')
    expect(previewMode('shot.PNG')).toBe('image')
    expect(previewMode('clip.webm')).toBe('video')
    expect(previewMode('take.mp3')).toBe('audio')
    expect(previewMode('archive.zip')).toBe('binary')
    expect(previewMode('LICENSE')).toBe('binary')
  })

  it('agrees with isTextual', () => {
    expect(isTextual('a.md')).toBe(true)
    expect(isTextual('a.json')).toBe(true)
    expect(isTextual('a.pdf')).toBe(false)
  })
})

describe('extOf / fmtBytes', () => {
  it('reads the extension off a path', () => {
    expect(extOf('/a/b/c.tar.gz')).toBe('gz')
    expect(extOf('/a/b/Makefile')).toBe('')
    expect(extOf('.gitignore')).toBe('')
  })

  it('formats sizes', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(fmtBytes(undefined)).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { classifyKind, fileDescriptor } from '../attachments'

describe('classifyKind', () => {
  it('classifies by mime type', () => {
    expect(classifyKind('image/png')).toBe('image')
    expect(classifyKind('video/mp4')).toBe('video')
    expect(classifyKind('audio/mpeg')).toBe('audio')
    expect(classifyKind('application/pdf')).toBe('file')
    expect(classifyKind('application/vnd.ms-excel')).toBe('file')
  })

  it('falls back to the extension when mime is missing or generic', () => {
    expect(classifyKind('', 'photo.PNG')).toBe('image')
    expect(classifyKind('application/octet-stream', 'clip.mov')).toBe('video')
    expect(classifyKind('application/octet-stream', 'song.flac')).toBe('audio')
    expect(classifyKind('application/octet-stream', 'notes.pdf')).toBe('file')
  })

  it('does not mis-classify documents as audio (the original bug)', () => {
    expect(classifyKind('application/pdf', 'report.pdf')).not.toBe('audio')
    expect(classifyKind('text/csv', 'data.csv')).not.toBe('audio')
  })
})

describe('fileDescriptor', () => {
  it('gives first-class icon/label for common formats', () => {
    expect(fileDescriptor('application/pdf', 'a.pdf')).toMatchObject({ icon: 'pdf', label: 'PDF' })
    expect(fileDescriptor('', 'a.docx')).toMatchObject({ icon: 'doc', label: 'DOCX' })
    expect(fileDescriptor('', 'a.csv')).toMatchObject({ icon: 'sheet', label: 'CSV' })
    expect(fileDescriptor('', 'a.pptx')).toMatchObject({ icon: 'slides' })
    expect(fileDescriptor('', 'a.json')).toMatchObject({ icon: 'code' })
    expect(fileDescriptor('', 'a.zip')).toMatchObject({ icon: 'archive' })
    expect(fileDescriptor('', 'a.md')).toMatchObject({ icon: 'text', label: 'MD' })
  })

  it('uses the mime hint when there is no useful extension', () => {
    expect(fileDescriptor('application/pdf', 'noext')).toMatchObject({ icon: 'pdf' })
    expect(fileDescriptor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'noext')).toMatchObject({ icon: 'sheet' })
  })

  it('falls back to a generic file descriptor for unknown types', () => {
    const d = fileDescriptor('application/x-weird', 'thing.qqq')
    expect(d.icon).toBe('file')
    expect(d.label).toBe('QQQ')
  })
})

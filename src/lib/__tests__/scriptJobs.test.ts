import { describe, it, expect } from 'vitest'
import { parseJobId } from '../scriptJobs'

describe('parseJobId', () => {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

  it('extracts the jobId from a script_start result', () => {
    const result = `Script started in the background.\njobId: ${uuid}\nPoll script_status…`
    expect(parseJobId(result)).toBe(uuid)
  })

  it('is case-insensitive on the label and hex', () => {
    expect(parseJobId(`JOBID: ${uuid.toUpperCase()}`)).toBe(uuid.toUpperCase())
  })

  it('returns null when there is no jobId', () => {
    expect(parseJobId('Could not start script: ENOENT')).toBeNull()
    expect(parseJobId('')).toBeNull()
    expect(parseJobId(undefined)).toBeNull()
  })

  it('ignores a malformed (non-uuid) id', () => {
    expect(parseJobId('jobId: not-a-uuid')).toBeNull()
  })
})

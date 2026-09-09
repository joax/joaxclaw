import { describe, it, expect } from 'vitest'
import {
  STATS_STALE_AFTER_MS, describeLastSeen, describeUsage, diskUsed, formatBytes,
  loadFraction, memoryUsed, statsAreStale, usedFraction, type NodeHostStats,
} from '../nodeStats'

const NOW = 1_700_000_000_000
const GB = 1024 ** 3

const stats = (over: Partial<NodeHostStats> = {}): NodeHostStats => ({
  cpuCount: 8,
  loadAverage: [2, 1.5, 1],
  memoryTotalBytes: 16 * GB,
  memoryFreeBytes: 4 * GB,
  diskTotalBytes: 500 * GB,
  diskAvailableBytes: 100 * GB,
  updatedAtMs: NOW - 1000,
  ...over,
})

describe('usedFraction', () => {
  it('reports the used share', () => {
    expect(usedFraction(16 * GB, 4 * GB)).toBeCloseTo(0.75)
  })

  it('distinguishes "not reported" from zero', () => {
    // Null must not render as an empty meter implying nothing is in use.
    expect(usedFraction(undefined, 4)).toBeNull()
    expect(usedFraction(16, undefined)).toBeNull()
    expect(usedFraction(0, 0)).toBeNull()
    expect(usedFraction(16 * GB, 16 * GB)).toBe(0)
  })

  it('rejects impossible readings rather than charting them', () => {
    expect(usedFraction(10, 20)).toBeNull()   // free exceeds total
    expect(usedFraction(10, -1)).toBeNull()
  })
})

describe('memoryUsed / diskUsed', () => {
  it('read their own halves of the snapshot', () => {
    expect(memoryUsed(stats())).toBeCloseTo(0.75)
    expect(diskUsed(stats())).toBeCloseTo(0.8)
  })

  it('are null when the gateway omitted the pair', () => {
    // Disk fields appear together only when the host can read its home volume.
    expect(diskUsed(stats({ diskTotalBytes: undefined, diskAvailableBytes: undefined }))).toBeNull()
    expect(memoryUsed(undefined)).toBeNull()
  })
})

describe('loadFraction', () => {
  it('scales load by core count, since load is per-core', () => {
    // 4.0 across 8 cores is half loaded, not 400%.
    expect(loadFraction(stats({ loadAverage: [4, 0, 0], cpuCount: 8 }))).toBeCloseTo(0.5)
  })

  it('clamps a host loaded beyond its core count', () => {
    expect(loadFraction(stats({ loadAverage: [32, 0, 0], cpuCount: 8 }))).toBe(1)
  })

  it('is null where there is no load average', () => {
    // Windows reports none, and hosts omit it when all three readings are zero.
    expect(loadFraction(stats({ loadAverage: undefined }))).toBeNull()
    expect(loadFraction(stats({ cpuCount: undefined }))).toBeNull()
    expect(loadFraction(stats({ cpuCount: 0 }))).toBeNull()
  })
})

describe('statsAreStale', () => {
  it('treats a fresh snapshot as current', () => {
    expect(statsAreStale(stats(), NOW)).toBe(false)
  })

  it('flags the projected snapshot of an offline node', () => {
    // The gateway keeps serving the last saved reading with its original timestamp, so
    // age is the only signal that it is not current.
    expect(statsAreStale(stats({ updatedAtMs: NOW - STATS_STALE_AFTER_MS - 1 }), NOW)).toBe(true)
  })

  it('treats an unstamped or missing snapshot as stale', () => {
    expect(statsAreStale(stats({ updatedAtMs: undefined }), NOW)).toBe(true)
    expect(statsAreStale(undefined, NOW)).toBe(true)
  })
})

describe('formatBytes', () => {
  it('scales to a readable unit', () => {
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(16 * GB)).toBe('16GB')
    expect(formatBytes(1.5 * GB)).toBe('1.5GB')
  })

  it('renders a dash rather than a wrong number', () => {
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
  })
})

describe('describeUsage', () => {
  it('reads as a sentence', () => {
    expect(describeUsage(16 * GB, 4 * GB)).toBe('12GB of 16GB')
  })

  it('is null when the pair is unreported, so nothing is invented', () => {
    expect(describeUsage(undefined, undefined)).toBeNull()
  })
})

describe('describeLastSeen', () => {
  it('translates the gateway reasons', () => {
    expect(describeLastSeen('device-token-auth')).toBe('signed in')
    expect(describeLastSeen('silent_push')).toBe('woken by a push')
  })

  it('degrades a future reason into something readable', () => {
    expect(describeLastSeen('some_new_reason')).toBe('some new reason')
  })

  it('is empty when absent', () => {
    expect(describeLastSeen(undefined)).toBe('')
  })
})

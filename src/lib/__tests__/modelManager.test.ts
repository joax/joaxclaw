import { describe, it, expect } from 'vitest'
import { parseParamsB, estimateContextBytes, ramFootprint } from '../modelManager'

describe('parseParamsB', () => {
  it('parses B / M suffixes', () => {
    expect(parseParamsB('7B')).toBe(7)
    expect(parseParamsB('1.5B')).toBe(1.5)
    expect(parseParamsB('135M')).toBeCloseTo(0.135)
  })
  it('handles mixture-of-experts "8x7B"', () => {
    expect(parseParamsB('8x7B')).toBe(56)
  })
  it('is undefined for missing / unparseable input', () => {
    expect(parseParamsB(undefined)).toBeUndefined()
    expect(parseParamsB('unknown')).toBeUndefined()
  })
})

describe('estimateContextBytes', () => {
  it('scales with params and context window; ~1GB for 7B @ 8k', () => {
    const b = estimateContextBytes('7B', 8192)
    expect(b).toBeGreaterThan(0.8e9)
    expect(b).toBeLessThan(1.3e9)
  })
  it('grows with more context', () => {
    expect(estimateContextBytes('7B', 16384)).toBeGreaterThan(estimateContextBytes('7B', 8192))
  })
  it('is 0 when the param size is unknown', () => {
    expect(estimateContextBytes(undefined)).toBe(0)
  })
})

describe('ramFootprint', () => {
  const GB = 1024 ** 3
  it('estimate mode: splits weights + context as fractions of RAM', () => {
    const fp = ramFootprint({ diskBytes: 4 * GB, paramSize: '7B', ramTotal: 32 * GB })
    expect(fp.actual).toBe(false)
    expect(fp.weights).toBe(4 * GB)
    expect(fp.context).toBeGreaterThan(0)
    expect(fp.total).toBe(fp.weights + fp.context)
    expect(fp.capacityLabel).toBe('RAM')
    expect(fp.fracWeights).toBeCloseTo(4 / 32, 2)
    expect(fp.overCapacity).toBe(false)
  })
  it('actual mode: uses the real /api/ps size and VRAM capacity on the GPU', () => {
    // qwen3-VL loaded at 256k ctx: 48 GB resident, all on GPU.
    const fp = ramFootprint({ diskBytes: 6 * GB, actualSize: 48 * GB, actualVram: 48 * GB, ramTotal: 32 * GB, vramTotal: 48 * GB, contextTokens: 262144 })
    expect(fp.actual).toBe(true)
    expect(fp.total).toBe(48 * GB)
    expect(fp.weights).toBe(6 * GB)
    expect(fp.context).toBe(42 * GB)          // 48 − 6, the real KV cache at 256k
    expect(fp.onGpu).toBe(true)
    expect(fp.capacityLabel).toBe('VRAM')
    expect(fp.contextTokens).toBe(262144)
    expect(fp.fracTotal).toBeCloseTo(1, 5)
  })
  it('flags over-capacity when the model exceeds the pool', () => {
    const fp = ramFootprint({ diskBytes: 40 * GB, paramSize: '70B', ramTotal: 16 * GB })
    expect(fp.overCapacity).toBe(true)
    expect(fp.fracTotal).toBeGreaterThan(1)
  })
})

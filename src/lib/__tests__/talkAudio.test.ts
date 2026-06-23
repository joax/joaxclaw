import { describe, it, expect } from 'vitest'
import { floatTo16BitPCM, pcm16ToFloat32, downsample, int16ToBase64, base64ToInt16, rms } from '../talkAudio'

describe('PCM conversion', () => {
  it('float ↔ pcm16 round-trips within quantization error', () => {
    const f = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123])
    const back = pcm16ToFloat32(floatTo16BitPCM(f))
    for (let i = 0; i < f.length; i++) expect(back[i]).toBeCloseTo(f[i], 3)
  })
  it('clamps out-of-range input', () => {
    const pcm = floatTo16BitPCM(new Float32Array([2, -2]))
    expect(pcm[0]).toBe(0x7fff)
    expect(pcm[1]).toBe(-0x8000)
  })
})

describe('base64 ↔ int16', () => {
  it('round-trips a PCM buffer', () => {
    const pcm = new Int16Array([0, 1, -1, 12345, -12345, 32767, -32768])
    const back = base64ToInt16(int16ToBase64(pcm))
    expect(Array.from(back)).toEqual(Array.from(pcm))
  })
})

describe('downsample', () => {
  it('halves the length going 48k → 24k', () => {
    const input = new Float32Array(480)
    const out = downsample(input, 48000, 24000)
    expect(out.length).toBe(240)
  })
  it('is a no-op when rates match', () => {
    const input = new Float32Array([1, 2, 3])
    expect(downsample(input, 24000, 24000)).toBe(input)
  })
})

describe('rms', () => {
  it('is 0 for silence and ~1 for full-scale', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 5)
  })
  it('returns 0 for an empty frame', () => {
    expect(rms(new Float32Array([]))).toBe(0)
  })
})

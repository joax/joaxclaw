import { describe, it, expect } from 'vitest'
import { connectionSignal, type PingSample } from '../connectionSignal'

const ok = (rtt: number): PingSample => ({ time: 0, rtt, ok: true })
const fail = (): PingSample => ({ time: 0, rtt: 0, ok: false })

describe('connectionSignal', () => {
  it('reports offline when not connected regardless of samples', () => {
    const s = connectionSignal([ok(10)], 'disconnected')
    expect(s.level).toBe('none')
    expect(s.bars).toBe(0)
    expect(s.rtt).toBeNull()
  })

  it('is "measuring" when connected but no samples yet', () => {
    const s = connectionSignal([], 'connected')
    expect(s.level).toBe('measuring')
    expect(s.bars).toBe(0)
    expect(s.rtt).toBeNull()
  })

  it('rates fast, lossless links excellent (4 bars)', () => {
    const s = connectionSignal([ok(20), ok(30), ok(25)], 'connected')
    expect(s.level).toBe('excellent')
    expect(s.bars).toBe(4)
    expect(s.rtt).toBe(25)
    expect(s.loss).toBe(0)
  })

  it('rates mid-latency links good and higher-latency fair', () => {
    expect(connectionSignal([ok(120), ok(140)], 'connected').level).toBe('good')
    expect(connectionSignal([ok(300), ok(350)], 'connected').level).toBe('fair')
  })

  it('rates very slow links poor', () => {
    const s = connectionSignal([ok(900), ok(1200)], 'connected')
    expect(s.level).toBe('poor')
    expect(s.bars).toBe(1)
  })

  it('uses the median so a single spike does not dominate', () => {
    const s = connectionSignal([ok(20), ok(25), ok(2000)], 'connected')
    expect(s.rtt).toBe(25)
    expect(s.level).toBe('excellent')
  })

  it('is poor when connected but every recent ping fails', () => {
    const s = connectionSignal([fail(), fail(), fail()], 'connected')
    expect(s.level).toBe('poor')
    expect(s.rtt).toBeNull()
    expect(s.loss).toBe(1)
  })

  it('caps the rating at poor under heavy loss even if survivors are fast', () => {
    const s = connectionSignal([ok(20), fail(), fail()], 'connected')
    expect(s.loss).toBeCloseTo(2 / 3)
    expect(s.level).toBe('poor')
  })

  it('knocks the rating down one notch under moderate loss', () => {
    // 1 of 5 lost (20%) with excellent latency → downgraded to good.
    const s = connectionSignal([ok(20), ok(25), ok(30), ok(22), fail()], 'connected')
    expect(s.loss).toBeCloseTo(0.2)
    expect(s.level).toBe('good')
  })

  it('only considers the most recent window of samples', () => {
    // A long run of old slow pings followed by recent fast ones → excellent.
    const old = Array.from({ length: 10 }, () => ok(1500))
    const recent = [ok(20), ok(25), ok(30), ok(20), ok(25), ok(30), ok(20), ok(25)]
    const s = connectionSignal([...old, ...recent], 'connected')
    expect(s.level).toBe('excellent')
  })
})

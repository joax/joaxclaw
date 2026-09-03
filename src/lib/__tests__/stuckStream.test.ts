import { describe, it, expect } from 'vitest'
import { reconcileStreams, STUCK_STREAM_GRACE_MS } from '../stuckStream'

// Default to mayBeYielding:true so the existing cases still exercise the grace period;
// the no-thread case (the common one) is covered explicitly below.
const conv = (id: string, streaming: boolean, sessionKey?: string, mayBeYielding = true) =>
  ({ id, streaming, sessionKey, mayBeYielding })
const T0 = 1_700_000_000_000

describe('reconcileStreams', () => {
  it('does not settle on the first idle observation — a controller reads idle at a yield boundary', () => {
    const r = reconcileStreams([conv('c1', true, 'agent:main:x')], () => false, new Map(), T0)
    expect(r.settle).toEqual([])
    expect(r.idleSince.get('c1')).toBe(T0)
  })

  it('settles once the session has been idle for the whole grace period', () => {
    const first = reconcileStreams([conv('c1', true, 'k')], () => false, new Map(), T0)
    const later = reconcileStreams([conv('c1', true, 'k')], () => false, first.idleSince, T0 + STUCK_STREAM_GRACE_MS)
    expect(later.settle).toEqual(['c1'])
  })

  it('does not settle while the gateway still reports the session running', () => {
    const first = reconcileStreams([conv('c1', true, 'k')], () => false, new Map(), T0)
    const busy = reconcileStreams([conv('c1', true, 'k')], () => true, first.idleSince, T0 + STUCK_STREAM_GRACE_MS)
    expect(busy.settle).toEqual([])
    // The clock resets, so a later idle spell must serve its own full grace period.
    expect(busy.idleSince.has('c1')).toBe(false)
  })

  it('restarts the grace period after a run resumes — the auto-resume case', () => {
    let acc = reconcileStreams([conv('c1', true, 'k')], () => false, new Map(), T0).idleSince
    acc = reconcileStreams([conv('c1', true, 'k')], () => true, acc, T0 + 4_000).idleSince   // resumed
    const after = reconcileStreams([conv('c1', true, 'k')], () => false, acc, T0 + 5_000)
    expect(after.settle).toEqual([])
    const wayLater = reconcileStreams([conv('c1', true, 'k')], () => false, after.idleSince, T0 + 5_000 + STUCK_STREAM_GRACE_MS)
    expect(wayLater.settle).toEqual(['c1'])
  })

  // A turn sent before its session row exists must never be cut off.
  it('treats an unknown session as not-idle, however long it stays unknown', () => {
    const first = reconcileStreams([conv('c1', true, 'k')], () => undefined, new Map(), T0)
    const later = reconcileStreams([conv('c1', true, 'k')], () => undefined, first.idleSince, T0 + STUCK_STREAM_GRACE_MS * 10)
    expect(first.settle).toEqual([])
    expect(later.settle).toEqual([])
  })

  it('ignores conversations that are not streaming, and ones with no session', () => {
    const r = reconcileStreams(
      [conv('done', false, 'k'), conv('local', true, undefined)],
      () => false, new Map(), T0 + STUCK_STREAM_GRACE_MS,
    )
    expect(r.settle).toEqual([])
  })

  it('settles several stuck conversations independently', () => {
    const convs = [conv('a', true, 'ka'), conv('b', true, 'kb')]
    const first = reconcileStreams(convs, () => false, new Map(), T0)
    const later = reconcileStreams(convs, k => k === 'kb', first.idleSince, T0 + STUCK_STREAM_GRACE_MS)
    expect(later.settle).toEqual(['a'])
  })

  // The reported bug: a completed answer followed by an empty spinning placeholder. No
  // sub-agent thread is in flight, so there is no yield to wait for and nothing is gained
  // by making the user watch a spinner for another 8 seconds.
  it('settles immediately when no sub-agent thread is in flight', () => {
    const r = reconcileStreams([conv('c1', true, 'k', false)], () => false, new Map(), T0)
    expect(r.settle).toEqual(['c1'])
  })

  it('still waits out the grace period when a thread could be mid-yield', () => {
    const r = reconcileStreams([conv('c1', true, 'k', true)], () => false, new Map(), T0)
    expect(r.settle).toEqual([])
  })

  it('never settles a no-thread turn while the gateway calls the session running', () => {
    const r = reconcileStreams([conv('c1', true, 'k', false)], () => true, new Map(), T0)
    expect(r.settle).toEqual([])
  })
})

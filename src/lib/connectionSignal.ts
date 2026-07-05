import type { ConnectionStatus } from './types'

// A single round-trip latency measurement against the gateway. `ok:false` means
// the ping failed or timed out (the gateway was unreachable for that attempt).
export interface PingSample {
  time: number
  rtt: number
  ok: boolean
}

export type SignalLevel = 'none' | 'measuring' | 'poor' | 'fair' | 'good' | 'excellent'

export interface ConnectionSignal {
  level: SignalLevel
  // 0–4 filled bars, for a wifi-style indicator. 0 = disconnected/no data.
  bars: 0 | 1 | 2 | 3 | 4
  // Median round-trip latency (ms) over the recent window, or null before the
  // first successful ping.
  rtt: number | null
  // Fraction of recent pings that failed (0–1).
  loss: number
  label: string
}

// Only the most recent samples describe the *current* connection — older ones
// reflect conditions that may no longer hold. We look at a short trailing window.
const WINDOW = 8

// Latency thresholds (ms), measured over a WebSocket to the gateway. A local
// gateway lands in single-digit ms; a healthy remote one in the tens-to-low
// hundreds. Beyond ~600ms round-trips the UI feels sluggish.
const RTT_EXCELLENT = 80
const RTT_GOOD = 200
const RTT_FAIR = 600

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Derive a connection-strength summary from recent ping samples. Combines
// latency (median RTT) with reliability (recent packet loss) — a fast but flaky
// link is not "strong", and neither is a rock-steady but very slow one.
export function connectionSignal(samples: PingSample[], status: ConnectionStatus): ConnectionSignal {
  if (status !== 'connected') {
    return { level: 'none', bars: 0, rtt: null, loss: 0, label: 'Offline' }
  }

  const recent = samples.slice(-WINDOW)
  if (recent.length === 0) {
    return { level: 'measuring', bars: 0, rtt: null, loss: 0, label: 'Measuring…' }
  }

  const oks = recent.filter(s => s.ok)
  const loss = (recent.length - oks.length) / recent.length

  // No successful pings in the window: the link is up (WS still connected) but
  // requests aren't completing — treat as poor unless we simply have no data yet.
  if (oks.length === 0) {
    return { level: 'poor', bars: 1, rtt: null, loss, label: 'Poor' }
  }

  const rtt = Math.round(median(oks.map(s => s.rtt)))

  // Heavy loss caps the rating regardless of how fast the surviving pings were.
  if (loss >= 0.5) return { level: 'poor', bars: 1, rtt, loss, label: 'Poor' }

  let level: SignalLevel
  if (rtt < RTT_EXCELLENT) level = 'excellent'
  else if (rtt < RTT_GOOD) level = 'good'
  else if (rtt < RTT_FAIR) level = 'fair'
  else level = 'poor'

  // Moderate loss (occasional dropped ping) knocks the rating down one notch —
  // an excellent-latency link with intermittent drops is really only "good".
  if (loss >= 0.2 && level !== 'poor') {
    level = level === 'excellent' ? 'good' : level === 'good' ? 'fair' : 'poor'
  }

  const bars = level === 'excellent' ? 4 : level === 'good' ? 3 : level === 'fair' ? 2 : 1
  const label = level.charAt(0).toUpperCase() + level.slice(1)
  return { level, bars: bars as ConnectionSignal['bars'], rtt, loss, label }
}

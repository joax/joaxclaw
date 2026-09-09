// Host resource stats for connected nodes, and presence for paired devices.
//
// Two different things the gateway reports, both new to the app:
//
//   DEVICES (`device.pair.list`) are the clients paired with this gateway — a browser,
//   a phone, this app. Their rows already carried `connected`, `lastSeenAtMs` and
//   `lastSeenReason`, and the Devices panel rendered none of them: you could not tell an
//   online device from one last seen in April.
//
//   NODES (`node.list` / `node.describe`) are clients that expose capabilities to agents
//   (camera, screen, canvas). Since OpenClaw 2026.9 they report a resource snapshot on
//   connect and every 60s, surfaced as `hostStats` and broadcast as `node.hostStats`.
//   The gateway stamps `updatedAtMs` on receipt — nodes never send a timestamp — and
//   projects the last saved snapshot while a node is offline, so a stale reading is
//   normal and must be shown with its age rather than as current truth.

export interface NodeHostStats {
  cpuCount?: number
  /** 1, 5 and 15 minute averages. Absent on Windows, which has no load average. */
  loadAverage?: number[]
  memoryTotalBytes?: number
  memoryFreeBytes?: number
  diskTotalBytes?: number
  diskAvailableBytes?: number
  /** Gateway receipt time, not node time. */
  updatedAtMs?: number
}

export interface GatewayNode {
  nodeId: string
  displayName?: string
  platform?: string
  connected?: boolean
  lastSeenAtMs?: number
  lastSeenReason?: string
  caps?: string[]
  hostStats?: NodeHostStats
}

/** A snapshot older than this is labelled rather than read as current. */
export const STATS_STALE_AFTER_MS = 5 * 60_000

export function statsAreStale(stats: NodeHostStats | undefined, now = Date.now()): boolean {
  if (!stats?.updatedAtMs) return true
  return now - stats.updatedAtMs > STATS_STALE_AFTER_MS
}

/**
 * Used fraction 0..1, or null when the gateway didn't report both halves.
 *
 * Null and zero are different answers — "not reported" must not render as an empty
 * meter implying the host has no memory in use.
 */
export function usedFraction(total: number | undefined, free: number | undefined): number | null {
  if (typeof total !== 'number' || typeof free !== 'number') return null
  if (!(total > 0) || free < 0 || free > total) return null
  return (total - free) / total
}

export function memoryUsed(stats: NodeHostStats | undefined): number | null {
  return usedFraction(stats?.memoryTotalBytes, stats?.memoryFreeBytes)
}

export function diskUsed(stats: NodeHostStats | undefined): number | null {
  return usedFraction(stats?.diskTotalBytes, stats?.diskAvailableBytes)
}

/**
 * Load average as a fraction of capacity, or null when either half is missing.
 *
 * Load is per-core, so 4.0 on 8 cores is half loaded, not "400%". Windows reports no
 * load average at all; hosts also omit it when all three readings are zero.
 */
export function loadFraction(stats: NodeHostStats | undefined): number | null {
  const one = stats?.loadAverage?.[0]
  const cores = stats?.cpuCount
  if (typeof one !== 'number' || typeof cores !== 'number' || cores <= 0) return null
  return Math.min(one / cores, 1)
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit++ }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)}${UNITS[unit]}`
}

/** "6.2GB of 16GB", or null when the pair isn't reported. */
export function describeUsage(total: number | undefined, free: number | undefined): string | null {
  if (usedFraction(total, free) === null) return null
  return `${formatBytes((total as number) - (free as number))} of ${formatBytes(total)}`
}

// Why a device or node was last seen. The gateway's reasons are terse identifiers; these
// are what a person would call them.
const SEEN_REASONS: Record<string, string> = {
  connect: 'connected',
  'device-token-auth': 'signed in',
  background: 'woke in the background',
  silent_push: 'woken by a push',
  bg_app_refresh: 'background refresh',
  significant_location: 'location change',
  manual: 'opened by hand',
}

export function describeLastSeen(reason: string | undefined): string {
  if (!reason) return ''
  return SEEN_REASONS[reason] ?? reason.replace(/[_-]+/g, ' ')
}

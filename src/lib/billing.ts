import type { GwModelCost, GwModelProvider } from './types'

// Billing math for the Billing view.
//
// The gateway's `sessions.usage` report is the source of truth for TOKENS: it reads
// every session transcript and buckets tokens by day, model and agent. We do NOT use
// its `totalCost` — the gateway prices against whatever rates it has, which are often
// absent or wrong (a typical report comes back with thousands of `missingCostEntries`).
// Instead every dollar shown in the Billing view is recomputed here from the prices
// the user set on the Models page, so the two pages can never disagree.

const MS_HOUR = 3_600_000

// ── Gateway payload shapes (sessions.usage) ───────────────────────────────────

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  totalCost: number          // the gateway's own estimate — shown only for comparison
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  missingCostEntries: number
}

export interface UsageByModel {
  provider?: string
  model?: string
  count: number
  totals: UsageTotals
}

export interface UsageByAgent { agentId: string; totals: UsageTotals }

/** Per-day, per-model tokens. Note: NO input/output split — see `bucketSpend`. */
export interface UsageModelDay {
  date: string             // YYYY-MM-DD, bucketed in the requested timezone
  provider?: string
  model?: string
  tokens: number
  cost: number
  count: number
}

export interface UsageDay {
  date: string
  tokens: number
  cost: number
  messages: number
  toolCalls: number
  errors: number
}

export interface UsageSession {
  key: string
  label?: string
  sessionId?: string
  agentId?: string
  channel?: string
  model?: string
  modelProvider?: string
  updatedAt?: number
  usage: UsageTotals | null
}

/** The gateway builds its per-session cost cache lazily; until it reports `fresh`,
 *  numbers are partial and the view keeps polling. */
export interface UsageCacheStatus {
  status: string           // 'fresh' | 'refreshing' | …
  cachedFiles: number
  pendingFiles: number
  staleFiles: number
  refreshedAt?: number
}

export interface SessionsUsage {
  updatedAt: number
  startDate: string
  endDate: string
  sessions: UsageSession[]
  totals: UsageTotals
  aggregates: {
    byModel: UsageByModel[]
    byProvider: UsageByModel[]
    byAgent: UsageByAgent[]
    modelDaily: UsageModelDay[]
    daily: UsageDay[]
  }
  cacheStatus?: UsageCacheStatus
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/** Parse `YYYY-MM-DD` as a LOCAL calendar date. `new Date('2026-08-09')` would parse
 *  as UTC midnight and shift the day for anyone west of Greenwich. */
export function parseDayLabel(label: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

export function dayLabel(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `UTC-4` / `UTC+5:30` — the gateway's `mode: 'specific'` offset format, so its day
 *  buckets are cut on the user's midnight rather than UTC's. */
export function utcOffsetLabel(date: Date = new Date()): string {
  const mins = -date.getTimezoneOffset()
  const sign = mins < 0 ? '-' : '+'
  const abs = Math.abs(mins)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

/** Monday-anchored week start for the local date `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (out.getDay() + 6) % 7   // 0 = Monday
  out.setDate(out.getDate() - dow)
  return out
}

// ── Prices ────────────────────────────────────────────────────────────────────

export type PriceMatch = 'exact' | 'alias' | 'none'
export interface PriceLookup { cost?: GwModelCost; match: PriceMatch }

/** Find the Models-page price for a usage row.
 *
 *  Usage rows name the provider the run actually went through, which is not always a
 *  provider id from the config: a cron pool shows up as `ollama-cron` against the
 *  `ollama` provider, and model ids differ in case (`qwen3.6:35B-A3B` vs
 *  `qwen3.6:35b`). Exact match first, then a related provider id, then a unique
 *  match anywhere — an ambiguous match is reported as unpriced rather than guessed. */
export function resolvePrice(
  providers: Record<string, GwModelProvider>,
  provider?: string,
  model?: string,
): PriceLookup {
  if (!model) return { match: 'none' }
  const want = model.toLowerCase()
  const findIn = (pid: string) => providers[pid]?.models?.find(m => m.id.toLowerCase() === want)

  if (provider) {
    const hit = findIn(provider)
    if (hit?.cost) return { cost: hit.cost, match: 'exact' }
  }

  const ids = Object.keys(providers)
  const related = provider
    ? ids.filter(id => id !== provider && (id.startsWith(provider) || provider.startsWith(id)))
    : []
  for (const id of related) {
    const hit = findIn(id)
    if (hit?.cost) return { cost: hit.cost, match: 'alias' }
  }

  const anywhere = ids.map(findIn).filter((m): m is NonNullable<typeof m> => !!m?.cost)
  if (anywhere.length === 1) return { cost: anywhere[0].cost, match: 'alias' }
  return { match: 'none' }
}

/** Dollar cost of a token bundle. `input`, `cacheRead` and `cacheWrite` are disjoint
 *  in the gateway's accounting (cached tokens are subtracted out of `input`), so the
 *  four terms simply add. */
export function costOf(totals: UsageTotals, cost?: GwModelCost): number {
  if (!cost) return 0
  return (
    totals.input * (cost.input ?? 0) +
    totals.output * (cost.output ?? 0) +
    totals.cacheRead * (cost.cacheRead ?? 0) +
    totals.cacheWrite * (cost.cacheWrite ?? 0)
  )
}

export function emptyTotals(): UsageTotals {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: 0, totalCost: 0,
    inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
    missingCostEntries: 0,
  }
}

export function addTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    totalCost: a.totalCost + b.totalCost,
    inputCost: a.inputCost + b.inputCost,
    outputCost: a.outputCost + b.outputCost,
    cacheReadCost: a.cacheReadCost + b.cacheReadCost,
    cacheWriteCost: a.cacheWriteCost + b.cacheWriteCost,
    missingCostEntries: a.missingCostEntries + b.missingCostEntries,
  }
}

// ── Per-model rows ────────────────────────────────────────────────────────────

export function modelKey(provider?: string, model?: string): string {
  return `${(provider ?? 'unknown').toLowerCase()}::${(model ?? 'unknown').toLowerCase()}`
}

export interface ModelRow {
  key: string
  provider: string
  model: string
  count: number             // model calls in the range
  totals: UsageTotals
  cost: number              // priced with the user's rates
  gatewayCost: number       // the gateway's own estimate, for comparison
  priced: boolean           // false → no price set on the Models page
  match: PriceMatch
  ratePerToken: number      // blended $/token, used to spread daily buckets
}

/** Price every model in the report. This is the exact figure: `byModel` carries the
 *  full input/output/cache split, so each token type is charged at its own rate. */
export function buildModelRows(
  byModel: UsageByModel[],
  providers: Record<string, GwModelProvider>,
): ModelRow[] {
  return byModel
    .map(entry => {
      const { cost, match } = resolvePrice(providers, entry.provider, entry.model)
      const priced = costOf(entry.totals, cost)
      const tokens = entry.totals.totalTokens
      return {
        key: modelKey(entry.provider, entry.model),
        provider: entry.provider ?? 'unknown',
        model: entry.model ?? 'unknown',
        count: entry.count,
        totals: entry.totals,
        cost: priced,
        gatewayCost: entry.totals.totalCost,
        priced: !!cost,
        match,
        ratePerToken: tokens > 0 ? priced / tokens : 0,
      }
    })
    .sort((a, b) => b.cost - a.cost || b.totals.totalTokens - a.totals.totalTokens)
}

// ── Time buckets ──────────────────────────────────────────────────────────────

export interface BucketModelSlice {
  key: string
  provider: string
  model: string
  tokens: number
  cost: number
}

export interface SpendBucket {
  key: string          // YYYY-MM-DD of the bucket start
  label: string        // axis label
  startMs: number
  cost: number
  tokens: number
  models: BucketModelSlice[]   // top contributors, for the tooltip
}

/** Spread spend across days (or Monday-anchored weeks).
 *
 *  `modelDaily` gives per-day tokens per model but NOT the input/output split, so a
 *  day cannot be priced directly. Each model's blended $/token for the range (from
 *  `buildModelRows`, which does have the split) is applied to its daily tokens. The
 *  bars therefore sum to the same range total as the tables — only the distribution
 *  across days assumes a model's token mix is steady within the range. */
export function bucketSpend(params: {
  modelDaily: UsageModelDay[]
  rows: ModelRow[]
  group: 'day' | 'week'
  startDate: string
  endDate: string
}): SpendBucket[] {
  const { modelDaily, rows, group, startDate, endDate } = params
  const rateByKey = new Map(rows.map(r => [r.key, r.ratePerToken]))
  const allowed = new Set(rows.map(r => r.key))

  const start = parseDayLabel(startDate)
  const end = parseDayLabel(endDate)
  if (!start || !end || end < start) return []

  // Enumerate every bucket in range first, so quiet days render as gaps in the axis
  // instead of collapsing the timeline.
  const buckets = new Map<string, SpendBucket>()
  const cursor = group === 'week' ? weekStart(start) : new Date(start)
  while (cursor <= end) {
    const key = dayLabel(cursor)
    buckets.set(key, {
      key,
      label: group === 'week'
        ? `${cursor.getMonth() + 1}/${cursor.getDate()}`
        : `${cursor.getMonth() + 1}/${cursor.getDate()}`,
      startMs: cursor.getTime(),
      cost: 0,
      tokens: 0,
      models: [],
    })
    cursor.setDate(cursor.getDate() + (group === 'week' ? 7 : 1))
  }

  const sliceAcc = new Map<string, Map<string, BucketModelSlice>>()

  for (const entry of modelDaily) {
    const key = modelKey(entry.provider, entry.model)
    if (!allowed.has(key)) continue          // filtered out by the provider/model filter
    const day = parseDayLabel(entry.date)
    if (!day) continue
    const bucketKey = dayLabel(group === 'week' ? weekStart(day) : day)
    const bucket = buckets.get(bucketKey)
    if (!bucket) continue

    const cost = entry.tokens * (rateByKey.get(key) ?? 0)
    bucket.cost += cost
    bucket.tokens += entry.tokens

    const slices = sliceAcc.get(bucketKey) ?? new Map<string, BucketModelSlice>()
    const slice = slices.get(key) ?? {
      key,
      provider: entry.provider ?? 'unknown',
      model: entry.model ?? 'unknown',
      tokens: 0,
      cost: 0,
    }
    slice.tokens += entry.tokens
    slice.cost += cost
    slices.set(key, slice)
    sliceAcc.set(bucketKey, slices)
  }

  for (const [bucketKey, slices] of sliceAcc) {
    const bucket = buckets.get(bucketKey)
    if (bucket) bucket.models = Array.from(slices.values()).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  }

  return Array.from(buckets.values()).sort((a, b) => a.startMs - b.startMs)
}

// ── Burn rate ─────────────────────────────────────────────────────────────────

export interface SpendRates {
  hours: number       // hours of the range that have actually elapsed
  perHour: number
  perDay: number
  perWeek: number
}

/** Average burn over the elapsed part of the range.
 *
 *  The gateway's finest bucket is a day, so an hourly figure can only be a rate, not
 *  a measurement. The range is clipped to `now` so today's partial day doesn't
 *  deflate the average. */
export function deriveRates(cost: number, startMs: number, endMs: number, now: number = Date.now()): SpendRates {
  const end = Math.min(endMs, now)
  const hours = Math.max((end - startMs) / MS_HOUR, 1)
  const perHour = cost / hours
  return { hours, perHour, perDay: perHour * 24, perWeek: perHour * 24 * 7 }
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1000) return `$${(n / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  if (abs >= 1) return `$${n.toFixed(2)}`
  if (abs >= 0.01) return `$${n.toFixed(3)}`
  return `$${n.toPrecision(2)}`
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

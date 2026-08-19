import { describe, it, expect } from 'vitest'
import {
  resolvePrice, costOf, buildModelRows, bucketSpend, deriveRates,
  parseDayLabel, dayLabel, weekStart, utcOffsetLabel, modelKey, fmtUsd,
  type UsageTotals, type UsageByModel, type UsageModelDay,
} from '../billing'
import type { GwModelProvider } from '../types'

function totals(p: Partial<UsageTotals>): UsageTotals {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    totalTokens: (p.input ?? 0) + (p.output ?? 0) + (p.cacheRead ?? 0) + (p.cacheWrite ?? 0),
    totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
    missingCostEntries: 0,
    ...p,
  }
}

const PROVIDERS: Record<string, GwModelProvider> = {
  google: {
    models: [{
      id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro',
      cost: { input: 1.25e-6, output: 10e-6, cacheRead: 0.31e-6, cacheWrite: 0 },
    }],
  },
  ollama: {
    models: [{ id: 'qwen3.6:35b', name: 'Qwen', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  },
  anthropic: {
    models: [{ id: 'claude-opus-5', name: 'Opus 5' }],   // no cost configured
  },
}

describe('resolvePrice', () => {
  it('matches provider + model exactly', () => {
    const r = resolvePrice(PROVIDERS, 'google', 'gemini-3.1-pro-preview')
    expect(r.match).toBe('exact')
    expect(r.cost?.input).toBe(1.25e-6)
  })

  it('matches model ids case-insensitively', () => {
    // usage reports "qwen3.6:35B-A3B"-style casing that config does not use
    expect(resolvePrice(PROVIDERS, 'ollama', 'QWEN3.6:35B').match).toBe('exact')
  })

  it('falls back to a related provider id (cron pools alias the base provider)', () => {
    const r = resolvePrice(PROVIDERS, 'ollama-cron', 'qwen3.6:35b')
    expect(r.match).toBe('alias')
    expect(r.cost).toBeDefined()
  })

  it('reports none when the model has no configured price', () => {
    expect(resolvePrice(PROVIDERS, 'anthropic', 'claude-opus-5').match).toBe('none')
  })

  it('reports none for an unknown model rather than guessing', () => {
    expect(resolvePrice(PROVIDERS, 'google', 'not-a-model').match).toBe('none')
  })
})

describe('costOf', () => {
  it('charges each token class at its own rate', () => {
    const cost = costOf(
      totals({ input: 1_000_000, output: 100_000, cacheRead: 2_000_000 }),
      { input: 1.25e-6, output: 10e-6, cacheRead: 0.31e-6, cacheWrite: 0 },
    )
    // 1.25 + 1.00 + 0.62
    expect(cost).toBeCloseTo(2.87, 6)
  })

  it('is zero without a price', () => {
    expect(costOf(totals({ input: 5_000_000 }), undefined)).toBe(0)
  })
})

describe('buildModelRows', () => {
  const byModel: UsageByModel[] = [
    { provider: 'ollama', model: 'qwen3.6:35b', count: 10, totals: totals({ input: 50_000_000, output: 200_000 }) },
    { provider: 'google', model: 'gemini-3.1-pro-preview', count: 5, totals: totals({ input: 1_000_000, output: 100_000 }) },
    { provider: 'anthropic', model: 'claude-opus-5', count: 2, totals: totals({ input: 10_000, output: 1_000 }) },
  ]

  it('prices with the user rates and sorts by spend', () => {
    const rows = buildModelRows(byModel, PROVIDERS)
    expect(rows[0].model).toBe('gemini-3.1-pro-preview')     // $2.25 beats free local tokens
    expect(rows[0].cost).toBeCloseTo(1.25 + 1.0, 6)
  })

  it('marks models with no configured price as unpriced', () => {
    const rows = buildModelRows(byModel, PROVIDERS)
    const opus = rows.find(r => r.model === 'claude-opus-5')!
    expect(opus.priced).toBe(false)
    expect(opus.cost).toBe(0)
  })

  it('keeps a zero-priced local model priced (free is a price, not a gap)', () => {
    const rows = buildModelRows(byModel, PROVIDERS)
    const local = rows.find(r => r.model === 'qwen3.6:35b')!
    expect(local.priced).toBe(true)
    expect(local.cost).toBe(0)
  })

  it('derives a blended per-token rate for daily spreading', () => {
    const rows = buildModelRows(byModel, PROVIDERS)
    const g = rows.find(r => r.model === 'gemini-3.1-pro-preview')!
    expect(g.ratePerToken).toBeCloseTo(2.25 / 1_100_000, 12)
  })
})

describe('bucketSpend', () => {
  const rows = buildModelRows(
    [{ provider: 'google', model: 'gemini-3.1-pro-preview', count: 5, totals: totals({ input: 1_000_000, output: 100_000 }) }],
    PROVIDERS,
  )
  const modelDaily: UsageModelDay[] = [
    { date: '2026-08-10', provider: 'google', model: 'gemini-3.1-pro-preview', tokens: 550_000, cost: 0, count: 2 },
    { date: '2026-08-12', provider: 'google', model: 'gemini-3.1-pro-preview', tokens: 550_000, cost: 0, count: 3 },
  ]

  it('emits a bucket for every day in range, including quiet ones', () => {
    const b = bucketSpend({ modelDaily, rows, group: 'day', startDate: '2026-08-10', endDate: '2026-08-13' })
    expect(b.map(x => x.key)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'])
    expect(b[1].cost).toBe(0)
  })

  it('daily buckets reconcile to the range total', () => {
    const b = bucketSpend({ modelDaily, rows, group: 'day', startDate: '2026-08-10', endDate: '2026-08-13' })
    const sum = b.reduce((s, x) => s + x.cost, 0)
    expect(sum).toBeCloseTo(rows[0].cost, 9)
  })

  it('groups into Monday-anchored weeks', () => {
    // 2026-08-10 is a Monday, so both days land in the same week bucket
    const b = bucketSpend({ modelDaily, rows, group: 'week', startDate: '2026-08-10', endDate: '2026-08-13' })
    expect(b).toHaveLength(1)
    expect(b[0].cost).toBeCloseTo(rows[0].cost, 9)
  })

  it('ignores models filtered out of the row set', () => {
    const other: UsageModelDay[] = [
      ...modelDaily,
      { date: '2026-08-11', provider: 'ollama', model: 'qwen3.6:35b', tokens: 9_000_000, cost: 0, count: 1 },
    ]
    const b = bucketSpend({ modelDaily: other, rows, group: 'day', startDate: '2026-08-10', endDate: '2026-08-13' })
    expect(b[1].tokens).toBe(0)
  })

  it('records per-model slices for the tooltip', () => {
    const b = bucketSpend({ modelDaily, rows, group: 'day', startDate: '2026-08-10', endDate: '2026-08-13' })
    expect(b[0].models[0].model).toBe('gemini-3.1-pro-preview')
  })

  it('returns nothing for an inverted range', () => {
    expect(bucketSpend({ modelDaily, rows, group: 'day', startDate: '2026-08-13', endDate: '2026-08-10' })).toEqual([])
  })
})

describe('deriveRates', () => {
  it('averages over the elapsed part of the range', () => {
    const start = Date.UTC(2026, 7, 10)
    const now = start + 48 * 3_600_000
    const r = deriveRates(24, start, start + 7 * 86_400_000, now)
    expect(r.hours).toBe(48)
    expect(r.perHour).toBeCloseTo(0.5, 9)
    expect(r.perDay).toBeCloseTo(12, 9)
    expect(r.perWeek).toBeCloseTo(84, 9)
  })

  it('does not divide by a sub-hour range', () => {
    const start = Date.now()
    const r = deriveRates(5, start, start + 60_000, start + 60_000)
    expect(r.hours).toBe(1)
    expect(r.perHour).toBe(5)
  })
})

describe('date helpers', () => {
  it('parses day labels in local time', () => {
    const d = parseDayLabel('2026-08-09')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(9)          // not shifted by the timezone
  })

  it('round-trips through dayLabel', () => {
    expect(dayLabel(parseDayLabel('2026-01-05')!)).toBe('2026-01-05')
  })

  it('rejects malformed labels', () => {
    expect(parseDayLabel('08/09/2026')).toBeNull()
  })

  it('anchors weeks on Monday', () => {
    expect(dayLabel(weekStart(parseDayLabel('2026-08-16')!))).toBe('2026-08-10')  // Sunday → prior Monday
    expect(dayLabel(weekStart(parseDayLabel('2026-08-10')!))).toBe('2026-08-10')  // Monday → itself
  })

  it('formats a gateway-legal utc offset', () => {
    expect(utcOffsetLabel(new Date())).toMatch(/^UTC[+-]\d{1,2}(:[0-5]\d)?$/)
  })
})

describe('modelKey', () => {
  it('is case-insensitive so usage rows and config rows collapse together', () => {
    expect(modelKey('Ollama', 'Qwen3.6:35B')).toBe(modelKey('ollama', 'qwen3.6:35b'))
  })
})

describe('fmtUsd', () => {
  it('scales the precision to the magnitude', () => {
    expect(fmtUsd(0)).toBe('$0')
    expect(fmtUsd(12.3456)).toBe('$12.35')
    expect(fmtUsd(0.0234)).toBe('$0.023')
    expect(fmtUsd(0.00012)).toBe('$0.00012')
    expect(fmtUsd(2500)).toBe('$2.5k')
  })
})

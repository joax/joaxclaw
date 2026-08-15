import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Wallet, AlertTriangle, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { useBillingStore, isWarming, type BillingRange, type BillingGroup } from '../../store/billing'
import { useModelsStore } from '../../store/models'
import { useAgentsStore } from '../../store/agents'
import {
  buildModelRows, bucketSpend, deriveRates, resolvePrice, costOf,
  parseDayLabel, fmtUsd, fmtTokens,
  type ModelRow, type SpendBucket, type UsageSession,
} from '../../lib/billing'
import { ProviderLogo } from '../ui/ProviderLogo'
import { Btn } from '../ui/Btn'

const RANGES: { id: BillingRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 days' },
  { id: '30d',   label: '30 days' },
  { id: '90d',   label: '90 days' },
  { id: '1y',    label: '1 year' },
  { id: 'all',   label: 'All' },
]

type SortKey = 'cost' | 'tokens' | 'calls'

export function BillingView() {
  const { data, loading, refetching, error, range, agentId, group, fetchedAt,
          setRange, setAgent, setGroup, fetch } = useBillingStore()
  const providers = useModelsStore(s => s.providers)
  const loadModels = useModelsStore(s => s.load)
  const agents = useAgentsStore(s => s.agents)
  const fetchAgents = useAgentsStore(s => s.fetch)

  const [provider, setProvider] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('cost')

  useEffect(() => {
    fetch()
    fetchAgents()
    // Prices live in the gateway config; the Billing view is often the first page
    // opened in a session, so make sure they are loaded before pricing anything.
    if (Object.keys(providers).length === 0) loadModels()
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pricing ────────────────────────────────────────────────────────────────
  const allRows = useMemo(
    () => data ? buildModelRows(data.aggregates.byModel, providers) : [],
    [data, providers],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter(r =>
      (provider === 'all' || r.provider === provider) &&
      (!q || r.model.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q)),
    )
  }, [allRows, provider, search])

  const sortedRows = useMemo(() => {
    const by: Record<SortKey, (r: ModelRow) => number> = {
      cost:   r => r.cost,
      tokens: r => r.totals.totalTokens,
      calls:  r => r.count,
    }
    return [...rows].sort((a, b) => by[sort](b) - by[sort](a))
  }, [rows, sort])

  const total = useMemo(() => ({
    cost:   rows.reduce((s, r) => s + r.cost, 0),
    tokens: rows.reduce((s, r) => s + r.totals.totalTokens, 0),
    calls:  rows.reduce((s, r) => s + r.count, 0),
    gateway: rows.reduce((s, r) => s + r.gatewayCost, 0),
  }), [rows])

  const buckets = useMemo(() => data ? bucketSpend({
    modelDaily: data.aggregates.modelDaily,
    rows,
    group,
    startDate: data.startDate,
    endDate: data.endDate,
  }) : [], [data, rows, group])

  const rates = useMemo(() => {
    const start = data ? parseDayLabel(data.startDate) : null
    const end = data ? parseDayLabel(data.endDate) : null
    if (!start || !end) return null
    // endDate is a calendar day — bill through the end of it.
    const endMs = end.getTime() + 86_400_000
    return deriveRates(total.cost, start.getTime(), endMs)
  }, [data, total.cost])

  const unpriced = useMemo(
    () => rows.filter(r => !r.priced && r.totals.totalTokens > 0),
    [rows],
  )

  const providerOptions = useMemo(() => {
    const ids = new Set(allRows.map(r => r.provider))
    return ['all', ...Array.from(ids).sort()]
  }, [allRows])

  const sessions = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.sessions
      .filter(s => s.usage && s.usage.totalTokens > 0)
      .filter(s => provider === 'all' || (s.modelProvider ?? '') === provider)
      .filter(s => !q || s.key.toLowerCase().includes(q) || (s.model ?? '').toLowerCase().includes(q))
      .map(s => {
        const { cost } = resolvePrice(providers, s.modelProvider, s.model)
        return { session: s, cost: s.usage ? costOf(s.usage, cost) : 0 }
      })
      .sort((a, b) => b.cost - a.cost || (b.session.usage?.totalTokens ?? 0) - (a.session.usage?.totalTokens ?? 0))
      .slice(0, 25)
  }, [data, providers, provider, search])

  const warming = isWarming(data)

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-3 shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Wallet size={17} style={{ color: 'var(--accent)' }} /> Billing
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Token usage from the gateway, priced with your rates from Gateway → Models.
          </p>
        </div>
        <Btn variant="outline" size="sm" icon={<RefreshCw size={13} />} onClick={() => fetch()} loading={loading || refetching}>
          Refresh
        </Btn>
      </div>

      {/* ── Filters — one row, scopes every chart and table below ──────── */}
      <div className="flex items-center gap-2 flex-wrap px-6 pb-3 shrink-0">
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          {RANGES.map(r => (
            <Chip key={r.id} label={r.label} active={range === r.id} onClick={() => setRange(r.id)} />
          ))}
        </div>

        <Select value={agentId ?? 'all'} onChange={v => setAgent(v === 'all' ? null : v)}>
          <option value="all">All agents</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name ?? a.id}</option>)}
        </Select>

        <Select value={provider} onChange={setProvider}>
          {providerOptions.map(p => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
        </Select>

        <div className="flex items-center gap-1.5 px-2 rounded-md" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', height: 28 }}>
          <Search size={12} style={{ color: 'var(--text-secondary)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter model or session…"
            className="text-xs"
            style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', width: 170 }}
          />
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg ml-auto" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          {(['day', 'week'] as BillingGroup[]).map(g => (
            <Chip key={g} label={g === 'day' ? 'Daily' : 'Weekly'} active={group === g} onClick={() => setGroup(g)} />
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-3 px-3 py-2 rounded text-sm shrink-0"
          style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {warming && (
        <div className="mx-6 mb-3 px-3 py-2 rounded text-xs flex items-center gap-2 shrink-0"
          style={{ background: 'color-mix(in srgb, var(--warning) 10%, transparent)', border: '1px solid var(--warning)', color: 'var(--warning)' }}>
          <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
          Gateway is still reading session transcripts ({data?.cacheStatus?.pendingFiles ?? 0} left) — totals will keep climbing.
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 pb-6" style={{ opacity: refetching ? 0.6 : 1, transition: 'opacity 0.15s' }}>
        {loading && !data ? (
          <div className="flex flex-1 items-center justify-center py-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Reading usage…
          </div>
        ) : !data || total.tokens === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20" style={{ color: 'var(--text-secondary)' }}>
            <Wallet size={32} style={{ opacity: 0.2 }} />
            <p className="text-sm">No usage in this range</p>
          </div>
        ) : (
          <>
            {/* Stat tiles — the headline numbers are numbers, not charts */}
            <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <Tile label={`Spend · ${RANGES.find(r => r.id === range)?.label}`} value={fmtUsd(total.cost)} accent />
              <Tile label="Per hour"  value={fmtUsd(rates?.perHour ?? 0)} hint={rates ? `over ${Math.round(rates.hours)}h elapsed` : undefined} />
              <Tile label="Per day"   value={fmtUsd(rates?.perDay ?? 0)}  hint="average burn rate" />
              <Tile label="Per week"  value={fmtUsd(rates?.perWeek ?? 0)} hint="average burn rate" />
              <Tile label="Tokens"    value={fmtTokens(total.tokens)}     hint={`${total.calls.toLocaleString()} model calls`} />
            </div>

            <SpendChart buckets={buckets} group={group} />

            {unpriced.length > 0 && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded text-xs"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <AlertTriangle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>{unpriced.length} model{unpriced.length > 1 ? 's' : ''} priced at $0</strong>
                  {' '}— no rate set on the Models page, so {fmtTokens(unpriced.reduce((s, r) => s + r.totals.totalTokens, 0))} tokens are missing from this bill:{' '}
                  <span className="font-mono">{unpriced.slice(0, 4).map(r => r.model).join(', ')}</span>
                  {unpriced.length > 4 && ` +${unpriced.length - 4} more`}
                </span>
              </div>
            )}

            <ModelTable rows={sortedRows} total={total} sort={sort} onSort={setSort} />

            <p className="text-xs mt-2 mb-5" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
              Gateway's own estimate for the same tokens: {fmtUsd(total.gateway)} — it prices against its
              built-in rates, which are usually unset. Every figure above uses yours.
            </p>

            <SessionTable rows={sessions} />

            {fetchedAt && (
              <p className="text-xs mt-4" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
                {data.startDate} → {data.endDate} · updated {new Date(fetchedAt).toLocaleTimeString()}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Spend over time ───────────────────────────────────────────────────────────

function SpendChart({ buckets, group }: { buckets: SpendBucket[]; group: BillingGroup }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...buckets.map(b => b.cost), 0)
  const peak = buckets.reduce((best, b, i) => (b.cost > (buckets[best]?.cost ?? -1) ? i : best), 0)

  if (buckets.length === 0) return null

  // Thin the axis labels so they never collide, whatever the range width.
  const step = Math.ceil(buckets.length / 12)
  const active = hover != null ? buckets[hover] : null

  return (
    <div className="rounded-lg mb-4 relative" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', padding: '14px 16px 10px' }}>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          Spend per {group === 'day' ? 'day' : 'week'}
        </span>
        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          {buckets.length} {group === 'day' ? 'days' : 'weeks'}
        </span>
      </div>

      <div className="relative" style={{ height: 132 }}>
        {/* Recessive gridlines: solid hairlines, one shade off the surface */}
        {[0, 0.5, 1].map(f => (
          <div key={f} style={{ position: 'absolute', left: 0, right: 0, bottom: `${f * 100}%`, height: 1, background: 'var(--border)', opacity: f === 0 ? 1 : 0.5 }} />
        ))}

        <div className="flex items-end gap-[2px] h-full relative">
          {buckets.map((b, i) => {
            const pct = max > 0 ? (b.cost / max) * 100 : 0
            const isHover = hover === i
            return (
              <div
                key={b.key}
                className="flex-1 h-full flex items-end"
                style={{ cursor: 'default', minWidth: 3 }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(h => (h === i ? null : h))}
              >
                <div
                  style={{
                    // Cap the thickness so a short range reads as a chart, not as blocks
                    width: '100%', maxWidth: 44, margin: '0 auto',
                    height: `${Math.max(pct, b.cost > 0 ? 1.5 : 0)}%`,
                    background: 'var(--accent)',
                    opacity: hover == null ? 0.85 : isHover ? 1 : 0.35,
                    borderRadius: '4px 4px 0 0',
                    transition: 'opacity 0.12s',
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* Selective direct label: the peak only. A tall bar reaches the top of the
            plot, so the label goes INSIDE it rather than colliding with the title. */}
        {max > 0 && hover == null && (
          <div
            className="absolute text-xs font-mono pointer-events-none"
            style={{
              left: `${((peak + 0.5) / buckets.length) * 100}%`,
              bottom: '100%',
              transform: 'translate(-50%, 18px)',
              color: 'var(--accent-fg)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtUsd(max)}
          </div>
        )}
      </div>

      {/* x-axis band lives inside the card, so it can never be clipped */}
      <div className="flex gap-[2px] mt-1.5">
        {buckets.map((b, i) => (
          <div key={b.key} className="flex-1 text-center" style={{ minWidth: 3 }}>
            {i % step === 0 && (
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)', opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
                {b.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {active && (
        <div
          className="absolute rounded-md px-2.5 py-2 pointer-events-none z-10"
          style={{
            top: 8,
            left: hover! < buckets.length / 2 ? undefined : 16,
            right: hover! < buckets.length / 2 ? 16 : undefined,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            minWidth: 170,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            {active.key}
          </div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-sm font-mono font-semibold" style={{ color: 'var(--accent)' }}>{fmtUsd(active.cost)}</span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{fmtTokens(active.tokens)} tok</span>
          </div>
          {active.models.slice(0, 4).map(m => (
            <div key={m.key} className="flex items-center justify-between gap-3 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-mono truncate" style={{ maxWidth: 120 }}>{m.model}</span>
              <span className="font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(m.cost)}</span>
            </div>
          ))}
          {active.models.length > 4 && (
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
              +{active.models.length - 4} more
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tables ────────────────────────────────────────────────────────────────────

function ModelTable({ rows, total, sort, onSort }: {
  rows: ModelRow[]
  total: { cost: number; tokens: number; calls: number }
  sort: SortKey
  onSort: (k: SortKey) => void
}) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ ...th, textAlign: 'left' }}>Model</th>
            <SortTh label="Calls"  active={sort === 'calls'}  onClick={() => onSort('calls')} />
            <th style={th}>Input</th>
            <th style={th}>Output</th>
            <th style={th}>Cache</th>
            <SortTh label="Tokens" active={sort === 'tokens'} onClick={() => onSort('tokens')} />
            <SortTh label="Cost"   active={sort === 'cost'}   onClick={() => onSort('cost')} />
            <th style={{ ...th, width: 90 }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const share = total.cost > 0 ? (r.cost / total.cost) * 100 : 0
            return (
              <tr key={r.key} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={td}>
                  <div className="flex items-center gap-2">
                    <ProviderLogo provider={`${r.provider}/${r.model}`} size={14} style={{ color: 'var(--text-secondary)' }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="font-mono text-xs truncate" style={{ color: 'var(--text-primary)' }}>{r.model}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                        {r.provider}
                        {r.match === 'alias' && <span title="Priced from a matching model on another provider"> · aliased price</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={num}>{r.count.toLocaleString()}</td>
                <td style={num}>{fmtTokens(r.totals.input)}</td>
                <td style={num}>{fmtTokens(r.totals.output)}</td>
                <td style={num}>{fmtTokens(r.totals.cacheRead + r.totals.cacheWrite)}</td>
                <td style={{ ...num, color: 'var(--text-primary)' }}>{fmtTokens(r.totals.totalTokens)}</td>
                <td style={{ ...num, color: r.priced ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: 600 }}>
                  {r.priced ? fmtUsd(r.cost) : <span title="No price set on the Models page">—</span>}
                </td>
                <td style={{ ...td, paddingRight: 14 }}>
                  <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2 }}>
                    <div style={{ width: `${share}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)' }}>Total</td>
            <td style={num}>{total.calls.toLocaleString()}</td>
            <td colSpan={3} />
            <td style={{ ...num, color: 'var(--text-primary)' }}>{fmtTokens(total.tokens)}</td>
            <td style={{ ...num, color: 'var(--accent)', fontWeight: 700 }}>{fmtUsd(total.cost)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function SessionTable({ rows }: { rows: { session: UsageSession; cost: number }[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <h2 className="text-xs font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Top sessions</h2>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...th, textAlign: 'left' }}>Session</th>
              <th style={{ ...th, textAlign: 'left' }}>Model</th>
              <th style={th}>Tokens</th>
              <th style={th}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ session, cost }) => (
              <tr key={session.key} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={td}>
                  <div className="text-xs truncate" style={{ color: 'var(--text-primary)', maxWidth: 320 }}>
                    {session.label ?? session.key}
                  </div>
                  {session.agentId && (
                    <div className="text-[10px]" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                      {session.agentId}{session.channel ? ` · ${session.channel}` : ''}
                    </div>
                  )}
                </td>
                <td style={{ ...td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {session.model ?? '—'}
                </td>
                <td style={num}>{fmtTokens(session.usage?.totalTokens ?? 0)}</td>
                <td style={{ ...num, color: 'var(--text-primary)', fontWeight: 600 }}>{fmtUsd(cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {/* Proportional figures: tabular-nums makes a large standalone number read loose */}
      <div className="text-xl font-semibold mt-0.5" style={{ color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>
        {value}
      </div>
      {hint && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{hint}</div>}
    </div>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium"
      style={{
        padding: '3px 9px', borderRadius: 6, cursor: 'pointer', border: 'none',
        background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  )
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-xs"
      style={{
        height: 28, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
        background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
      }}
    >
      {children}
    </select>
  )
}

function SortTh({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th style={th}>
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: active ? 'var(--accent)' : 'inherit', font: 'inherit', padding: 0 }}
      >
        {label}
        {active ? <ChevronDown size={10} /> : <ChevronUp size={10} style={{ opacity: 0.25 }} />}
      </button>
    </th>
  )
}

const th: React.CSSProperties = {
  padding: '8px 10px', fontSize: 11, fontWeight: 500, textAlign: 'right',
  color: 'var(--text-secondary)', whiteSpace: 'nowrap',
}

const td: React.CSSProperties = { padding: '7px 10px', verticalAlign: 'middle' }

const num: React.CSSProperties = {
  ...td, textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
  color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
}

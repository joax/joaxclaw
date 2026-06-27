import { useEffect, useState } from 'react'
import {
  RefreshCw, ChevronDown, ChevronRight, Copy, Check, Trash2, RotateCw, Ban,
  Globe, Smartphone, Monitor, Terminal, Server, ShieldCheck, KeyRound, X, AlertTriangle,
} from 'lucide-react'
import { Btn } from '../ui/Btn'
import { useIsAdmin } from '../../store/connection'
import {
  useDevicesStore, isLastAdminDevice, deviceHasAdmin,
  type PairedDevice, type PendingPair, type DeviceToken,
} from '../../store/devices'
import { relativeFromMs } from '../../lib/dateUtils'

// ── small shared bits ───────────────────────────────────────────────────────────

const C = {
  surface: 'var(--bg-surface)', elevated: 'var(--bg-elevated)', border: 'var(--border)',
  text: 'var(--text-primary)', dim: 'var(--text-secondary)',
  accent: 'var(--accent)', danger: 'var(--danger)', warning: 'var(--warning)', success: 'var(--success)',
}

function platformIcon(platform?: string, mode?: string) {
  const p = `${platform ?? ''} ${mode ?? ''}`.toLowerCase()
  if (/web|browser/.test(p)) return Globe
  if (/android|ios|iphone|mobile|phone/.test(p)) return Smartphone
  if (/cli|probe|terminal/.test(p)) return Terminal
  if (/mac|darwin|windows|win32/.test(p)) return Monitor
  if (/linux|server/.test(p)) return Server
  return Monitor
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200) }}
      title="Copy"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: done ? C.success : C.dim, padding: 2, display: 'inline-flex' }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'warning' | 'danger' }) {
  const col = tone === 'accent' ? C.accent : tone === 'warning' ? C.warning : tone === 'danger' ? C.danger : C.dim
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap',
      fontFamily: 'monospace',
      background: `color-mix(in srgb, ${col} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${col} 28%, transparent)`,
      color: col,
    }}>{children}</span>
  )
}

function ScopeChips({ scopes, max = 3 }: { scopes: string[]; max?: number }) {
  const shown = scopes.slice(0, max)
  const extra = scopes.length - shown.length
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {shown.map(s => <Chip key={s} tone={s === 'operator.admin' ? 'accent' : 'neutral'}>{s.replace(/^operator\./, '')}</Chip>)}
      {extra > 0 && <span style={{ fontSize: 10, color: C.dim, opacity: 0.7 }}>+{extra}</span>}
    </div>
  )
}

// ── Pending request card ────────────────────────────────────────────────────────

function PendingCard({ req, canManage }: { req: PendingPair; canManage: boolean }) {
  const { approve, reject, busy } = useDevicesStore()
  const Icon = platformIcon(req.platform, req.clientMode)
  const working = !!busy[req.requestId]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon size={16} style={{ color: C.accent, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {req.clientId || shortId(req.deviceId)}
            </span>
            {req.isRepair && <Chip tone="warning">repair</Chip>}
            {req.silent && <Chip>silent</Chip>}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
            {[req.platform, req.clientMode, req.role].filter(Boolean).join(' · ')} · {relativeFromMs(req.ts)}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: C.dim, opacity: 0.7 }}>wants</span>
        <ScopeChips scopes={req.scopes} max={4} />
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="ghost" disabled={working} onClick={() => void reject(req.requestId)}>Reject</Btn>
          <Btn size="sm" loading={working} icon={<Check size={12} />} onClick={() => void approve(req.requestId)}>Approve</Btn>
        </div>
      )}
    </div>
  )
}

// ── Token row ───────────────────────────────────────────────────────────────────

function TokenLine({ t }: { t: DeviceToken }) {
  const revoked = !!t.revokedAtMs
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.dim, padding: '3px 0' }}>
      <KeyRound size={11} style={{ color: revoked ? C.dim : C.success, flexShrink: 0, opacity: revoked ? 0.5 : 1 }} />
      <span style={{ fontFamily: 'monospace', color: revoked ? C.dim : C.text, textDecoration: revoked ? 'line-through' : 'none' }}>{t.role}</span>
      <span>· {t.scopes?.length ?? 0} scopes</span>
      <span>· created {relativeFromMs(t.createdAtMs)}</span>
      {t.rotatedAtMs && <span>· rotated {relativeFromMs(t.rotatedAtMs)}</span>}
      {revoked
        ? <Chip tone="danger">revoked {relativeFromMs(t.revokedAtMs)}</Chip>
        : <Chip tone="accent">active</Chip>}
    </div>
  )
}

// ── Paired device row ───────────────────────────────────────────────────────────

function DeviceRow({ device, canManage, paired }: { device: PairedDevice; canManage: boolean; paired: PairedDevice[] }) {
  const { remove, revokeToken, rotateToken, busy } = useDevicesStore()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<'remove' | 'revoke' | null>(null)
  const Icon = platformIcon(device.platform, device.clientMode)
  const working = !!busy[device.deviceId]

  const activeTokens = (device.tokens ?? []).filter(t => !t.revokedAtMs)
  const lastAdmin = isLastAdminDevice(paired, device.deviceId) && deviceHasAdmin(device)
  const name = device.displayName || device.clientId || shortId(device.deviceId)

  const ActionRow = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      <Btn size="sm" variant="outline" icon={<RotateCw size={12} />} loading={working}
        onClick={() => void rotateToken(device.deviceId, device.role, device.scopes)}>
        Rotate token
      </Btn>
      {confirm === 'revoke' ? (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Btn size="sm" variant="danger" loading={working} onClick={() => { setConfirm(null); void revokeToken(device.deviceId, device.role) }}>Confirm revoke</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Btn>
        </span>
      ) : (
        <Btn size="sm" variant="outline" icon={<Ban size={12} />} disabled={working || lastAdmin}
          title={lastAdmin ? 'This is the only admin device — revoking would lock out device management' : undefined}
          onClick={() => setConfirm('revoke')}>
          Revoke token
        </Btn>
      )}
      <div style={{ flex: 1 }} />
      {confirm === 'remove' ? (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Btn size="sm" variant="danger" loading={working} onClick={() => { setConfirm(null); void remove(device.deviceId) }}>Confirm remove</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Btn>
        </span>
      ) : (
        <Btn size="sm" variant="danger" icon={<Trash2 size={12} />} disabled={working || lastAdmin}
          title={lastAdmin ? 'This is the only admin device — removing would lock out device management' : undefined}
          onClick={() => setConfirm('remove')}>
          Remove device
        </Btn>
      )}
    </div>
  )

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      {/* Collapsed header (click to expand) */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <Icon size={16} style={{ color: C.dim, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            {deviceHasAdmin(device) && <ShieldCheck size={12} style={{ color: C.accent, flexShrink: 0 }} />}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[device.clientId, device.clientMode, device.platform].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: C.dim }}>{activeTokens.length} token{activeTokens.length !== 1 ? 's' : ''}</span>
          <span style={{ fontSize: 11, color: C.dim }} title={device.approvedAtMs ? new Date(device.approvedAtMs).toLocaleString() : undefined}>
            paired {relativeFromMs(device.approvedAtMs ?? device.createdAtMs)}
          </span>
          {open ? <ChevronDown size={14} style={{ color: C.dim }} /> : <ChevronRight size={14} style={{ color: C.dim }} />}
        </div>
      </button>

      {/* Scope chips (always visible, under header) */}
      <div style={{ padding: '0 12px 10px 38px' }}>
        <ScopeChips scopes={device.scopes} max={open ? 99 : 4} />
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 12px 12px 38px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2px 8px', alignItems: 'center', fontSize: 11, marginBottom: 8 }}>
            <span style={{ color: C.dim }}>deviceId</span>
            <span style={{ fontFamily: 'monospace', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{device.deviceId}</span>
            <CopyBtn value={device.deviceId} />
            <span style={{ color: C.dim }}>publicKey</span>
            <span style={{ fontFamily: 'monospace', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{device.publicKey}</span>
            <CopyBtn value={device.publicKey} />
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.dim, marginBottom: 2 }}>Tokens</div>
          {(device.tokens ?? []).length === 0
            ? <div style={{ fontSize: 11, color: C.dim, opacity: 0.6 }}>No token records</div>
            : (device.tokens ?? []).map((t, i) => <TokenLine key={i} t={t} />)}

          {canManage && ActionRow}
        </div>
      )}
    </div>
  )
}

// ── Rotate reveal modal ─────────────────────────────────────────────────────────

function RotateModal() {
  const { rotated, clearRotated } = useDevicesStore()
  if (!rotated) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={clearRotated}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '90vw', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
          <KeyRound size={15} style={{ color: C.accent }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>Token rotated</span>
          <button onClick={clearRotated} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim }}><X size={15} /></button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: C.dim, margin: 0 }}>
            New <span style={{ fontFamily: 'monospace', color: C.text }}>{rotated.role}</span> token for{' '}
            <span style={{ fontFamily: 'monospace', color: C.text }}>{shortId(rotated.deviceId)}</span>. The previous token is now revoked.
          </p>
          {rotated.token ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--radius)', background: C.elevated, border: `1px solid ${C.border}` }}>
                <code style={{ fontSize: 12, fontFamily: 'monospace', color: C.text, wordBreak: 'break-all', flex: 1 }}>{rotated.token}</code>
                <CopyBtn value={rotated.token} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.warning }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                Copy it now — this secret is shown only once and cannot be retrieved later.
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: C.dim, margin: 0 }}>The new secret was not returned to this connection. The device must re-pair to obtain it.</p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Btn size="sm" onClick={clearRotated}>Done</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────────

export function DevicesPanel({ connected }: { connected: boolean }) {
  const { pending, paired, loading, error, load, clearError } = useDevicesStore()
  const isAdmin = useIsAdmin()

  useEffect(() => { if (connected) void load() }, [connected, load])

  if (!connected) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontSize: 13 }}>
        Connect to a gateway to manage paired devices.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-6 flex flex-col gap-4" style={{ maxWidth: 720 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 className="text-base font-semibold" style={{ color: C.text }}>Devices</h2>
            <p style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Clients paired with this gateway and the tokens they hold.</p>
          </div>
          <Btn size="sm" variant="outline" icon={<RefreshCw size={12} />} loading={loading} onClick={() => void load()}>Refresh</Btn>
        </div>

        {!isAdmin && (
          <Note tone="warning">
            Read-only — this connection lacks <code style={{ fontFamily: 'monospace' }}>operator.admin</code>, so devices can be viewed but not managed.
          </Note>
        )}

        {error && (
          <Note tone="danger" onClose={clearError}>{error}</Note>
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <div style={{ border: `1px solid color-mix(in srgb, ${C.accent} 35%, transparent)`, borderRadius: 'var(--radius)', overflow: 'hidden', background: `color-mix(in srgb, ${C.accent} 5%, ${C.surface})` }}>
            <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.accent, borderBottom: `1px solid color-mix(in srgb, ${C.accent} 20%, transparent)` }}>
              Pending requests ({pending.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {pending.map((req, i) => (
                <div key={req.requestId} style={{ borderTop: i ? `1px solid color-mix(in srgb, ${C.accent} 15%, transparent)` : 'none' }}>
                  <PendingCard req={req} canManage={isAdmin} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Paired */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.dim, marginBottom: 6 }}>
            Paired devices ({paired.length})
          </div>
          {paired.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 12, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 'var(--radius)', background: C.surface }}>
              {loading ? 'Loading…' : 'No devices paired yet.'}
            </div>
          ) : (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 'var(--radius)', overflow: 'hidden', background: C.surface }}>
              {paired.map(d => <DeviceRow key={d.deviceId} device={d} canManage={isAdmin} paired={paired} />)}
            </div>
          )}
        </div>

        <p style={{ fontSize: 11, color: C.dim, opacity: 0.7, lineHeight: 1.5 }}>
          This app authenticates with the gateway token, so removing a device or revoking its token won't disconnect this app.
        </p>
      </div>

      <RotateModal />
    </div>
  )
}

function Note({ children, tone, onClose }: { children: React.ReactNode; tone: 'warning' | 'danger'; onClose?: () => void }) {
  const col = tone === 'danger' ? C.danger : C.warning
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 12, color: col, background: `color-mix(in srgb, ${col} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${col} 28%, transparent)` }}>
      <AlertTriangle size={13} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{children}</span>
      {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: col }}><X size={13} /></button>}
    </div>
  )
}

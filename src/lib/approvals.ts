// Approvals the gateway is holding open, waiting for a human decision.
//
// When an agent tries to run a command (or a plugin tool) that policy says needs sign-off,
// the gateway parks the run and broadcasts an approval request. Until now JoaxClaw
// ignored those entirely — it asked for `operator.approvals` at connect and never used
// it — so an agent blocked on one simply stalled, with nothing in the UI to say why.
//
// Three kinds, three pending-list methods, one resolver:
//
//   exec.approval.list      -> kind "exec"          a shell command
//   plugin.approval.list    -> kind "plugin"        a plugin tool
//   openclaw.approval.list  -> kind "system-agent"  a change to OpenClaw itself
//   approval.resolve { id, kind, decision }         resolves any of them
//
// The lists and the `*.approval.requested` broadcasts both carry the RAW request
// (`{ approvalKind, id, request, createdAtMs, expiresAtMs }`). The reviewer-safe
// `presentation` — which deliberately excludes the runtime cwd, environment and
// execution plan — comes only from `approval.get`, so that is what we render.

export type ApprovalKind = 'exec' | 'plugin' | 'system-agent'
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny'

/** Pending-list methods, keyed by the kind they return. */
export const APPROVAL_LIST_METHODS: Record<ApprovalKind, string> = {
  exec: 'exec.approval.list',
  plugin: 'plugin.approval.list',
  'system-agent': 'openclaw.approval.list',
}

const EVENT_KIND: Record<string, ApprovalKind> = {
  'exec.approval': 'exec',
  'plugin.approval': 'plugin',
  'openclaw.approval': 'system-agent',
}

/** `exec.approval.requested` -> `{ kind: 'exec', phase: 'requested' }`. */
export function parseApprovalEvent(event: string): { kind: ApprovalKind; phase: 'requested' | 'resolved' } | undefined {
  const m = /^(.+)\.(requested|resolved)$/.exec(event)
  const kind = m && EVENT_KIND[m[1]]
  return kind ? { kind, phase: m[2] as 'requested' | 'resolved' } : undefined
}

interface PresentationBase {
  agentId?: string | null
  allowedDecisions: ApprovalDecision[]
}
export interface ExecPresentation extends PresentationBase {
  kind: 'exec'
  commandText: string
  commandPreview?: string | null
  warningText?: string | null
  host?: string | null
}
export interface PluginPresentation extends PresentationBase {
  kind: 'plugin'
  title: string
  description: string
  detail?: string
  severity?: string
  pluginId?: string | null
  toolName?: string | null
}
export interface SystemAgentPresentation extends PresentationBase {
  kind: 'system-agent'
  title: string
  description: string
}
export type ApprovalPresentation = ExecPresentation | PluginPresentation | SystemAgentPresentation

export interface PendingApproval {
  id: string
  kind: ApprovalKind
  createdAtMs: number
  expiresAtMs: number
  presentation: ApprovalPresentation
}

export function isApprovalPending(a: PendingApproval, now = Date.now()): boolean {
  return a.expiresAtMs > now
}

/** Oldest first: the one that has been blocking a run longest is answered first. */
export function sortApprovals(list: Iterable<PendingApproval>): PendingApproval[] {
  return [...list].sort((a, b) => a.createdAtMs - b.createdAtMs)
}

export interface ApprovalSummary {
  /** One line naming what is being asked for. */
  title: string
  /** The specific thing — a command, a tool — shown in monospace when present. */
  subject?: string
  /** Explanatory text the plugin or system-agent request supplied. */
  description?: string
  /** A caution the gateway attached, e.g. an unrecognised or destructive command. */
  warning?: string
  agentId?: string
  /** Where it runs, when the gateway says so. */
  host?: string
}

/** Flatten the three presentation shapes into one thing the banner can render. */
export function summarize(p: ApprovalPresentation): ApprovalSummary {
  const agentId = p.agentId ?? undefined
  if (p.kind === 'exec') {
    return {
      title: 'An agent wants to run a command',
      subject: p.commandPreview || p.commandText,
      ...(p.warningText ? { warning: p.warningText } : {}),
      ...(agentId ? { agentId } : {}),
      ...(p.host ? { host: p.host } : {}),
    }
  }
  if (p.kind === 'plugin') {
    return {
      title: p.title,
      ...(p.toolName ? { subject: p.toolName } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(agentId ? { agentId } : {}),
    }
  }
  return {
    title: p.title,
    ...(p.description ? { description: p.description } : {}),
    ...(agentId ? { agentId } : {}),
  }
}

/**
 * The buttons to offer, in the order they should appear.
 *
 * Driven by the record rather than hardcoded: `allowedDecisions` differs per kind — a
 * system-agent approval permits only allow-once and deny — and the gateway guarantees
 * `deny` is always among them so a malformed or unsafe request can always fail closed.
 * Offering a decision the record does not allow would be rejected on resolve.
 */
export function decisionsFor(p: ApprovalPresentation): ApprovalDecision[] {
  const order: ApprovalDecision[] = ['allow-once', 'allow-always', 'deny']
  const allowed = new Set(p.allowedDecisions ?? [])
  const offered = order.filter(d => allowed.has(d))
  // Never render an approval with no way to refuse it, even if a gateway sent one.
  return offered.includes('deny') ? offered : [...offered, 'deny']
}

export function decisionLabel(d: ApprovalDecision): string {
  return d === 'allow-once' ? 'Allow once' : d === 'allow-always' ? 'Always allow' : 'Deny'
}

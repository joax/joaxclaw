import { describe, it, expect } from 'vitest'
import {
  APPROVAL_LIST_METHODS, approvalGetParams, approvalResolveParams,
  decisionLabel, decisionsFor, isApprovalPending,
  parseApprovalEvent, sortApprovals, summarize,
  type ExecPresentation, type PendingApproval, type PluginPresentation,
} from '../approvals'

const NOW = 1_700_000_000_000

const exec = (over: Partial<ExecPresentation> = {}): ExecPresentation => ({
  kind: 'exec',
  commandText: 'rm -rf ./build',
  allowedDecisions: ['allow-once', 'allow-always', 'deny'],
  ...over,
})

const approval = (over: Partial<PendingApproval> = {}): PendingApproval => ({
  id: 'a1',
  kind: 'exec',
  createdAtMs: NOW - 1000,
  expiresAtMs: NOW + 60_000,
  presentation: exec(),
  ...over,
})

describe('parseApprovalEvent', () => {
  it('maps each family to its kind', () => {
    expect(parseApprovalEvent('exec.approval.requested')).toEqual({ kind: 'exec', phase: 'requested' })
    expect(parseApprovalEvent('plugin.approval.resolved')).toEqual({ kind: 'plugin', phase: 'resolved' })
    // The system-agent kind is raised under the `openclaw.` prefix, not `system-agent.`.
    expect(parseApprovalEvent('openclaw.approval.requested')).toEqual({ kind: 'system-agent', phase: 'requested' })
  })

  it('ignores everything else on the socket', () => {
    expect(parseApprovalEvent('question.requested')).toBeUndefined()
    expect(parseApprovalEvent('chat')).toBeUndefined()
    expect(parseApprovalEvent('exec.approval.expired')).toBeUndefined()
  })

  it('covers every kind that has a list method', () => {
    const fromEvents = ['exec.approval', 'plugin.approval', 'openclaw.approval']
      .map(p => parseApprovalEvent(`${p}.requested`)?.kind)
    expect(new Set(fromEvents)).toEqual(new Set(Object.keys(APPROVAL_LIST_METHODS)))
  })
})

describe('isApprovalPending', () => {
  it('drops an approval past its deadline, which fails closed on the gateway', () => {
    expect(isApprovalPending(approval(), NOW)).toBe(true)
    expect(isApprovalPending(approval({ expiresAtMs: NOW - 1 }), NOW)).toBe(false)
  })
})

describe('sortApprovals', () => {
  it('puts the longest-blocked run first', () => {
    const older = approval({ id: 'old', createdAtMs: NOW - 9000 })
    const newer = approval({ id: 'new', createdAtMs: NOW - 10 })
    expect(sortApprovals([newer, older]).map(a => a.id)).toEqual(['old', 'new'])
  })
})

describe('decisionsFor', () => {
  it('offers only what the record allows, in a stable order', () => {
    expect(decisionsFor(exec())).toEqual(['allow-once', 'allow-always', 'deny'])
  })

  it('omits always-allow when the record withholds it', () => {
    // A system-agent approval permits exactly allow-once and deny.
    expect(decisionsFor(exec({ allowedDecisions: ['allow-once', 'deny'] }))).toEqual(['allow-once', 'deny'])
  })

  it('always leaves a way to refuse', () => {
    // The gateway guarantees deny is present so a request can fail closed; render it
    // even if some future gateway forgets, rather than showing allow-only buttons.
    expect(decisionsFor(exec({ allowedDecisions: ['allow-once'] }))).toContain('deny')
  })

  it('survives a record with no decisions at all', () => {
    expect(decisionsFor(exec({ allowedDecisions: [] }))).toEqual(['deny'])
  })
})

describe('summarize', () => {
  it('shows the command, preferring the gateway preview over the raw text', () => {
    const s = summarize(exec({ commandPreview: 'rm -rf …', warningText: 'Destructive', host: 'gateway' }))
    expect(s.subject).toBe('rm -rf …')
    expect(s.warning).toBe('Destructive')
    expect(s.host).toBe('gateway')
  })

  it('falls back to commandText when there is no preview', () => {
    expect(summarize(exec()).subject).toBe('rm -rf ./build')
  })

  it('uses the plugin request title and tool name', () => {
    const p: PluginPresentation = {
      kind: 'plugin', title: 'Send a payment', description: 'Transfer $40',
      toolName: 'stripe.charge', allowedDecisions: ['allow-once', 'deny'],
    }
    const s = summarize(p)
    expect(s.title).toBe('Send a payment')
    expect(s.subject).toBe('stripe.charge')
    expect(s.description).toBe('Transfer $40')
  })

  it('omits absent optional fields rather than passing undefined through', () => {
    const s = summarize(exec())
    expect('warning' in s).toBe(false)
    expect('host' in s).toBe(false)
    expect('agentId' in s).toBe(false)
  })
})

describe('decisionLabel', () => {
  it('reads as a button', () => {
    expect(decisionLabel('allow-once')).toBe('Allow once')
    expect(decisionLabel('allow-always')).toBe('Always allow')
    expect(decisionLabel('deny')).toBe('Deny')
  })
})

// Both methods take an id, and only one of them takes the kind. Sending `kind` to
// approval.get is a hard INVALID_REQUEST against its closed schema — and because the
// hydrate step swallows failures, the symptom was silent: no approval ever rendered.
// Verified against a live 2026.9.3 gateway, which answers "invalid approval.get params"
// for { id, kind } and "approval not found" for { id }.
describe('request params', () => {
  it('approval.get takes the id alone', () => {
    expect(approvalGetParams('abc')).toEqual({ id: 'abc' })
    expect(Object.keys(approvalGetParams('abc'))).toEqual(['id'])
  })

  it('approval.resolve takes the kind as well', () => {
    expect(approvalResolveParams('abc', 'exec', 'allow-once'))
      .toEqual({ id: 'abc', kind: 'exec', decision: 'allow-once' })
  })
})

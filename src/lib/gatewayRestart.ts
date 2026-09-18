import { gatewayClient } from './gateway'

// `gateway.restart.request` (operator.admin, in every gateway since 2026.7). The app used
// to believe there was no lifecycle RPC, and restarted a remote gateway by asking an
// agent to run `openclaw gateway restart` on the host.
//
// Without `skipDeferral` this is the gateway's SAFE restart: when work is running (chat
// runs, cron jobs, background tasks) it answers `status: "deferred"` and restarts once
// that work drains, rather than cutting it off. Callers should expect that wait.

export type RestartStatus = 'scheduled' | 'deferred' | 'coalesced'

// A request inside the 30 s cooldown after the last one is `coalesced`, and the restart
// may be scheduled `delayMs` later.
export async function requestGatewayRestart(reason: string): Promise<{ status: RestartStatus | undefined; delayMs: number }> {
  const res = await gatewayClient.request<{ status?: unknown; restart?: { delayMs?: unknown } }>('gateway.restart.request', { reason })
  const s = res?.status
  const delay = res?.restart?.delayMs
  return {
    status: s === 'scheduled' || s === 'deferred' || s === 'coalesced' ? s : undefined,
    delayMs: typeof delay === 'number' && delay > 0 ? delay : 0,
  }
}

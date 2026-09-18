import { gatewayClient } from './gateway'

// `gateway.restart.request` (operator.admin, in every gateway since 2026.7). The app used
// to believe there was no lifecycle RPC, and restarted a remote gateway by asking an
// agent to run `openclaw gateway restart` on the host.
//
// Without `skipDeferral` this is the gateway's SAFE restart: when work is running (chat
// runs, cron jobs, background tasks) it answers `status: "deferred"` and restarts once
// that work drains, rather than cutting it off. Callers should expect that wait.

export type RestartStatus = 'scheduled' | 'deferred' | 'coalesced'

export async function requestGatewayRestart(reason: string): Promise<{ status: RestartStatus | undefined }> {
  const res = await gatewayClient.request<{ status?: unknown }>('gateway.restart.request', { reason })
  const s = res?.status
  return { status: s === 'scheduled' || s === 'deferred' || s === 'coalesced' ? s : undefined }
}

// Gateway-host helpers: extract the host from the gateway WS URL and decide whether
// it's local. Kept here (historically the Ollama-health module) because these two
// are imported widely; the old Ollama-specific probing now lives in localEngines.ts.

export function gatewayHost(wsUrl: string | undefined): string | null {
  if (!wsUrl) return null
  try { return new URL(wsUrl).hostname || null } catch { return null }
}

export function isLocalGateway(host: string | null): boolean {
  return host === null || host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

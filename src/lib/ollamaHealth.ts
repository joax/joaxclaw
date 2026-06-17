// Resolves where to probe Ollama for health, and probes it via the Electron main
// process (not the renderer) so the check isn't CORS-bound and can reach a remote
// gateway host. Falls back to a direct fetch outside Electron (dev/browser).

export type OllamaInstance = 'main' | 'cron'
export type OllamaStatus = 'up' | 'down' | 'unknown'

const DEFAULT_PORT: Record<OllamaInstance, number> = { main: 11434, cron: 11435 }

export function gatewayHost(wsUrl: string | undefined): string | null {
  if (!wsUrl) return null
  try { return new URL(wsUrl).hostname || null } catch { return null }
}

export function isLocalGateway(host: string | null): boolean {
  return host === null || host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

type Resolved = { url: string; mode: 'explicit' | 'local' | 'derived' }

// Decide which URL to probe for an instance:
//  - explicit: user-provided override (reachable from this client)
//  - local:    gateway is local → Ollama is on this machine (localhost:port)
//  - derived:  gateway is remote → guess <gatewayHost>:port (may be firewalled)
export function resolveOllamaUrl(
  instance: OllamaInstance,
  gatewayUrl: string | undefined,
  override?: string
): Resolved | null {
  const ov = override?.trim()
  if (ov) return { url: ov.replace(/\/+$/, ''), mode: 'explicit' }
  const host = gatewayHost(gatewayUrl)
  const port = DEFAULT_PORT[instance]
  if (isLocalGateway(host)) return { url: `http://localhost:${port}`, mode: 'local' }
  return { url: `http://${host}:${port}`, mode: 'derived' }
}

type OllamaProbeApi = { probe?: (url: string) => Promise<{ ok: boolean }> }

async function probe(url: string): Promise<boolean> {
  // The main process probes the full URL as-is, so build the Ollama health path here.
  const healthUrl = `${url.replace(/\/+$/, '')}/api/tags`
  const api = (window as unknown as { api?: { ollama?: OllamaProbeApi } })?.api?.ollama
  if (api?.probe) {
    try { return (await api.probe(healthUrl)).ok } catch { return false }
  }
  // Non-Electron fallback (CORS-limited, localhost only)
  try {
    const r = await fetch(healthUrl)
    return r.ok
  } catch {
    return false
  }
}

export async function checkOllama(
  instance: OllamaInstance,
  gatewayUrl: string | undefined,
  override?: string
): Promise<OllamaStatus> {
  const target = resolveOllamaUrl(instance, gatewayUrl, override)
  if (!target) return 'unknown'
  const ok = await probe(target.url)
  if (ok) return 'up'
  // A failed *derived* (remote, auto-guessed) probe is inconclusive — the port may
  // simply be firewalled. Only an explicit/local failure means genuinely down.
  return target.mode === 'derived' ? 'unknown' : 'down'
}

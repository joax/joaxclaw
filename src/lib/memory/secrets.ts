// Memory credential values are either a literal, or an environment-variable reference
// of the form "env:VAR_NAME". The env-ref form keeps the plaintext secret OUT of the
// generated SKILL.md and out of the app's localStorage — the value is resolved only
// where the request is made: the client (via Electron's main process) for a local
// gateway, or the joaxclaw-fs plugin (host process.env) for a remote gateway.

const ENV_PREFIX = 'env:'
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isEnvRef(v: string | undefined): boolean {
  return typeof v === 'string' && v.startsWith(ENV_PREFIX)
}
export function envRefName(v: string): string {
  return v.slice(ENV_PREFIX.length).trim()
}
export function isValidEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name.trim())
}

type EnvApi = { get: (name: string) => Promise<{ ok: boolean; value?: string }> }
const envApi = (): EnvApi | undefined => (window as unknown as { api?: { env?: EnvApi } }).api?.env

// Resolve a literal-or-env-ref value to a literal (client-side; the env var must exist
// on the machine running the app, which is the gateway host for a LOCAL gateway).
export async function resolveSecret(v: string | undefined): Promise<string> {
  if (!v) return ''
  if (!isEnvRef(v)) return v
  const name = envRefName(v)
  if (!isValidEnvName(name)) return ''
  try {
    const res = await envApi()?.get(name)
    return res?.ok ? (res.value ?? '') : ''
  } catch { return '' }
}

// Resolve every value in a provider config (only credential fields are ever env-refs).
export async function resolveConfig(config: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(Object.entries(config).map(async ([k, v]) => { out[k] = await resolveSecret(v) }))
  return out
}

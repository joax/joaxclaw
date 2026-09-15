// The gateway's own list of models (`models.list`), used for two facts the app can't get
// from config: whether a model runs locally, and which thinking levels it accepts.
// (lib/modelCatalog.ts is something else: the curated Ollama list behind Discover.)
//
// Config lists what is configured. Only the gateway knows how it treats each model at
// run time. Ollama models accept off, low, medium, high and max; some models accept only
// off. A level the model doesn't accept, sent with a message, fails the whole turn.

export interface ThinkingLevelOption { id: string; label: string }

export interface GatewayModel {
  id: string
  provider: string
  /** Served by a local runtime (Ollama, LM Studio, …). Absent on older gateways. */
  local?: boolean
  thinkingLevels?: ThinkingLevelOption[]
}

export function parseModelChoices(res: unknown): GatewayModel[] {
  const list = Array.isArray(res)
    ? res
    : Array.isArray((res as { models?: unknown } | null)?.models) ? (res as { models: unknown[] }).models : []
  const out: GatewayModel[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    if (typeof m.id !== 'string' || typeof m.provider !== 'string') continue
    const levels = Array.isArray(m.thinkingLevels)
      ? m.thinkingLevels
          .filter((l): l is { id: string; label?: unknown } => !!l && typeof (l as { id?: unknown }).id === 'string')
          .map(l => ({ id: l.id, label: typeof l.label === 'string' ? l.label : l.id }))
      : undefined
    out.push({
      id: m.id,
      provider: m.provider,
      ...(typeof m.local === 'boolean' ? { local: m.local } : {}),
      ...(levels ? { thinkingLevels: levels } : {}),
    })
  }
  return out
}

/**
 * `provider/model` → its parts. A bare id takes `fallbackProvider`. Only the first slash
 * splits, the same way the context bar reads a session's model.
 */
export function splitModelRef(ref: string, fallbackProvider?: string | null): { provider?: string; id: string } {
  const r = ref.trim()
  const slash = r.indexOf('/')
  if (slash > 0) return { provider: r.slice(0, slash), id: r.slice(slash + 1) }
  return { ...(fallbackProvider ? { provider: fallbackProvider } : {}), id: r }
}

const norm = (s: string) => s.trim().toLowerCase()

export function findGatewayModel(
  models: GatewayModel[] | null | undefined,
  ref: string | null | undefined,
  fallbackProvider?: string | null,
): GatewayModel | undefined {
  if (!models?.length || !ref?.trim()) return undefined
  const hit = (provider: string | undefined, id: string) =>
    models.find(m => norm(m.id) === norm(id) && (provider === undefined || norm(m.provider) === norm(provider)))
  const { provider, id } = splitModelRef(ref, fallbackProvider)
  // A model id can itself contain a slash (e.g. `meta/llama-3` under openrouter). In that
  // case the whole ref is the id under the session's provider.
  return hit(provider, id) ?? (fallbackProvider && ref.includes('/') ? hit(fallbackProvider, ref.trim()) : undefined)
}

/** Mirrors the gateway's isCloudModelRef: a `:cloud` or `-cloud` source suffix marks a hosted model. */
export function isCloudModelRef(id: string): boolean {
  const s = norm(id)
  const sep = s.lastIndexOf(':')
  if (sep < 0) return false
  const source = s.slice(sep + 1)
  return source === 'cloud' || (!source.includes('/') && source.endsWith('-cloud'))
}

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio'])

/**
 * Whether a model runs on a local runtime. Newer gateways say so directly. Otherwise go
 * by provider: an Ollama or LM Studio model is local unless its tag marks it as hosted.
 */
export function isLocalModel(
  entry: GatewayModel | undefined,
  ref: string | null | undefined,
  fallbackProvider?: string | null,
): boolean {
  if (typeof entry?.local === 'boolean') return entry.local
  if (!ref?.trim()) return false
  const { provider, id } = splitModelRef(ref, fallbackProvider)
  return !!provider && LOCAL_PROVIDERS.has(norm(provider)) && !isCloudModelRef(id)
}

/** The thinking levels a model accepts, or null when the gateway didn't say (then all are offered). */
export function supportedThinkingLevels(entry: GatewayModel | undefined): Set<string> | null {
  return entry?.thinkingLevels?.length ? new Set(entry.thinkingLevels.map(l => norm(l.id))) : null
}

/**
 * The model a chat will run on: its own override, else what the session last ran, else
 * the agent's default.
 */
export function effectiveModelRef(p: {
  modelOverride?: string | null
  sessionModel?: string | null
  sessionProvider?: string | null
  agentDefault?: string | null
}): { ref?: string; fallbackProvider?: string } {
  if (p.modelOverride?.trim()) return { ref: p.modelOverride.trim() }
  if (p.sessionModel?.trim()) {
    return { ref: p.sessionModel.trim(), ...(p.sessionProvider ? { fallbackProvider: p.sessionProvider } : {}) }
  }
  if (p.agentDefault?.trim()) return { ref: p.agentDefault.trim() }
  return {}
}

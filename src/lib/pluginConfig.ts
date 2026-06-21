// ── Curated per-plugin configuration ──────────────────────────────────────────
//
// The Extensions view can enable/disable plugins; this adds editing a plugin's
// config + API key. Two things live in different places in the gateway config:
//
//   - behaviour config → plugins.entries.<id>.config / .llm
//   - API keys         → domain-scoped, NOT under the plugin entry:
//       model providers → models.providers.<id>.apiKey
//       TTS providers   → messages.tts.providers.<id>.apiKey
//       web search      → tools.web.search.apiKey (+ tools.web.search.provider)
//
// We curate which plugins need a key (and where it goes); everything else is still
// editable through the raw JSON5 editor. All writes go through config.patch, so it
// works on a local AND a remote gateway. Keys are string | SecretRef; SecretRefs are
// shown read-only and preserved (same convention as channels/models).

export type ApiKeyKind = 'provider' | 'tts' | 'webSearch'

export interface PluginConfigField {
  // Dotted path under plugins.entries.<id> (e.g. 'config.personality', 'llm.allowModelOverride').
  path: string
  label: string
  type: 'text' | 'boolean'
  placeholder?: string
  help?: string
}

export interface PluginConfigSpec {
  apiKey?: ApiKeyKind
  // Extra curated provider field(s) that live alongside the key in models.providers.<id>.
  providerBaseUrl?: boolean
  fields?: PluginConfigField[]
}

// Curated classification of the common key-needing plugins. Plugin id maps 1:1 to
// the provider id under models.providers / messages.tts.providers by convention.
const MODEL_PROVIDERS = [
  'openai', 'anthropic', 'google', 'deepseek', 'groq', 'mistral', 'xai', 'openrouter',
  'togetherai', 'together', 'fireworks', 'deepinfra', 'cerebras', 'perplexity', 'cohere',
  'alibaba', 'byteplus', 'arcee', 'chutes', 'moonshot', 'baseten', 'hyperbolic', 'nebius',
  'novita', 'sambanova', 'github-copilot', 'azure', 'azure-openai', 'minimax', 'venice',
]
const TTS_PROVIDERS = ['elevenlabs', 'deepgram', 'azure-speech', 'sherpa-onnx-tts', 'openai-whisper', 'openai-whisper-api']
const WEB_SEARCH = ['exa', 'firecrawl', 'tavily', 'brave', 'duckduckgo', 'serpapi', 'bing']

export function pluginConfigSpec(pluginId: string): PluginConfigSpec | null {
  if (MODEL_PROVIDERS.includes(pluginId)) return { apiKey: 'provider', providerBaseUrl: true }
  if (TTS_PROVIDERS.includes(pluginId)) return { apiKey: 'tts' }
  if (WEB_SEARCH.includes(pluginId)) return { apiKey: 'webSearch' }
  return null
}

// Where a plugin's API key lives in the config tree.
export function apiKeyPath(pluginId: string, kind: ApiKeyKind): string {
  switch (kind) {
    case 'provider':  return `models.providers.${pluginId}.apiKey`
    case 'tts':       return `messages.tts.providers.${pluginId}.apiKey`
    case 'webSearch': return `tools.web.search.apiKey`
  }
}

// ── path helpers ──────────────────────────────────────────────────────────────

export function readPath(obj: Record<string, unknown> | undefined, path: string): unknown {
  if (!obj) return undefined
  return path.split('.').reduce<unknown>(
    (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  )
}

// Build a nested patch object from a dotted path + value.
export function nestedPatch(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  const root: Record<string, unknown> = {}
  let cur = root
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value
    else { const next: Record<string, unknown> = {}; cur[k] = next; cur = next }
  })
  return root
}

// Recursively merge plain objects (so several nestedPatch()es combine into one patch).
export function mergeDeep(into: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(from)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object' && !Array.isArray(into[k])) {
      mergeDeep(into[k] as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      into[k] = v
    }
  }
  return into
}

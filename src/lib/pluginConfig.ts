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
  // Show the shared LLM settings group (llm.allowModelOverride / model / temperature).
  llm?: boolean
  // Curated behaviour fields under plugins.entries.<id> (path relative to that entry).
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
// Not DuckDuckGo: it's the key-free search provider (its manifest says
// `requiresCredential: false`, "no API key required"), so it never has a key to ask for.
const WEB_SEARCH = ['exa', 'firecrawl', 'tavily', 'brave', 'serpapi', 'bing']

export function pluginConfigSpec(pluginId: string): PluginConfigSpec | null {
  if (MODEL_PROVIDERS.includes(pluginId)) return { apiKey: 'provider', providerBaseUrl: true }
  if (TTS_PROVIDERS.includes(pluginId)) return { apiKey: 'tts' }
  if (WEB_SEARCH.includes(pluginId)) return { apiKey: 'webSearch' }
  return null
}

// Whether a plugin's required API key is set in the config.
//   'set'         — a literal key or a SecretRef is present
//   'missing'     — the plugin needs a key but none is configured (the curated heuristic)
//   'needs-setup' — the gateway itself says the plugin's required config is missing
//   'n/a'         — nothing to complete
export type PluginKeyStatus = 'set' | 'missing' | 'needs-setup' | 'n/a'

/** Whether the status asks the user to do something (the list's "Needs setup" group). */
export function keyStatusNeedsAttention(status: PluginKeyStatus | undefined): boolean {
  return status === 'missing' || status === 'needs-setup'
}

// ── The gateway's word on setup (plugins.list `state`, OpenClaw 2026.9.4) ────────
//
// The list's badge used to come only from the curated catalog above: "this id takes a key
// at this path; is anything there?" That guesses, and the guess drifted from the gateway.
// DuckDuckGo was listed as a web-search plugin needing a key, so after installing it the
// list said "Needs key" while the catalog detail pane, which reads the plugin's declared
// configuration, said "Nothing to configure". And on 2026.9 web-search keys moved under
// plugins.entries.<id>.config.webSearch, so the path it checked is the legacy one anyway.
//
// 2026.9.4's plugins.list says it directly. Each row's `state` is "needs-setup" when the
// plugin's manifest configSchema doesn't validate against its (missing) entry config, the
// same rule the gateway uses to decide whether it can enable the plugin
// (resolvePluginConfigEnablement), and the same `state` the catalog's `local.state`
// carries, so the detail pane's "Needs setup" pill and this badge agree. Neither
// plugins.list nor plugins.inspect describes secrets beyond that, so on such a gateway
// anything short of "needs-setup" is not a request for a key: at most a key we can see is
// set, shown as Configured.
//
// That `state` arrived with the catalog (plugins.catalog.*, 2026.9.4); 2026.9.3's rows
// have a `state` without the setup check, and 2026.8's have none. So the heuristic stays,
// only for gateways without the catalog.

export interface KeyStatusInput {
  pluginId: string
  config: Record<string, unknown> | undefined
  /** The plugin's plugins.list `state` from this gateway, when it has a row for it. */
  gatewayState?: unknown
  /** The gateway's plugins.list checks setup (it has plugins.catalog.browse: 2026.9.4+). */
  setupAware: boolean
}

export function resolvePluginKeyStatus(i: KeyStatusInput): PluginKeyStatus {
  const heuristic = pluginKeyStatus(i.config, i.pluginId)
  if (!i.setupAware || typeof i.gatewayState !== 'string') return heuristic
  if (i.gatewayState === 'needs-setup') return 'needs-setup'
  return heuristic === 'set' ? 'set' : 'n/a'
}

export function pluginKeyStatus(config: Record<string, unknown> | undefined, pluginId: string): PluginKeyStatus {
  const spec = pluginConfigSpec(pluginId)
  if (!spec?.apiKey) return 'n/a'
  const v = readPath(config, apiKeyPath(pluginId, spec.apiKey))
  // A non-empty string literal, or a SecretRef object ({ source, id }), counts as set.
  const set = (typeof v === 'string' && v.trim().length > 0) || (!!v && typeof v === 'object')
  return set ? 'set' : 'missing'
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

// ── Schema-driven field model ─────────────────────────────────────────────────
//
// A generic descriptor that the PluginConfigForm renders. Fields come from one of
// two sources (see fieldsFor): the gateway-provided JSON Schema (configSchema, when
// present) or the curated catalog above. `path` is an ABSOLUTE dotted path into the
// full gateway config, so the renderer reads/writes it with readPath/nestedPatch and
// everything goes through config.patch (local == remote). Anything not expressed as a
// field stays editable via the Advanced (raw) tab.

export type FieldKind = 'text' | 'secret' | 'boolean' | 'number' | 'enum' | 'textarea' | 'url'
// Which config subtree a field lives in — also used as the section heading.
export type FieldGroup = 'key' | 'llm' | 'config'

export interface FieldSpec {
  path: string
  label: string
  kind: FieldKind
  group: FieldGroup
  help?: string
  placeholder?: string
  default?: unknown
  required?: boolean
  options?: readonly string[]
  min?: number
  max?: number
  // When this field is written a non-empty value, also set this sibling path (e.g. the
  // shared web-search provider id alongside its shared api key).
  writeAlso?: { path: string; value: unknown }
}

// A minimal shape of what the app needs to resolve fields for a plugin. `configSchema`
// is the pass-through JSON Schema from the plugin manifest, surfaced by the gateway's
// plugins.list when available (see design/GATEWAY_ASK_plugin-configschema) — optional.
export interface PluginConfigTarget {
  id: string
  configSchema?: JsonSchema
}

// The shared LLM settings group most agent-ish plugins accept, under plugins.entries.<id>.llm.
function llmGroup(id: string): FieldSpec[] {
  const base = `plugins.entries.${id}.llm`
  return [
    { path: `${base}.allowModelOverride`, label: 'Allow model override', kind: 'boolean', group: 'llm', help: 'Let this plugin choose its own model instead of the agent default.' },
    { path: `${base}.model`, label: 'Model', kind: 'text', group: 'llm', placeholder: 'e.g. gpt-4o-mini', help: 'Model id to use when overriding.' },
    { path: `${base}.temperature`, label: 'Temperature', kind: 'number', group: 'llm', min: 0, max: 2, help: 'Sampling temperature (0–2).' },
  ]
}

// Build the curated FieldSpec[] for a plugin from its PluginConfigSpec: the API key
// (domain-scoped), an optional provider base URL, an optional shared LLM group, and any
// curated per-plugin behaviour fields (paths relative to plugins.entries.<id>).
export function curatedFields(id: string, config?: Record<string, unknown>): FieldSpec[] {
  const spec = pluginConfigSpec(id)
  if (!spec) {
    // No curated catalog entry — still offer the LLM group if the plugin already has one
    // configured (safe: those keys are known-good), so it can be edited without raw JSON.
    return hasLlmBlock(config, id) ? llmGroup(id) : []
  }
  const out: FieldSpec[] = []
  if (spec.apiKey) {
    out.push({
      path: apiKeyPath(id, spec.apiKey), label: 'API key', kind: 'secret', group: 'key',
      placeholder: 'paste a key, or an env var name', help: 'Leave blank to clear.',
      // Web-search plugins share one key path; record which provider the key belongs to.
      ...(spec.apiKey === 'webSearch' ? { writeAlso: { path: 'tools.web.search.provider', value: id } } : {}),
    })
  }
  if (spec.providerBaseUrl) {
    out.push({ path: `models.providers.${id}.baseUrl`, label: 'Base URL', kind: 'url', group: 'key', placeholder: 'https://api.example.com/v1', help: 'Optional endpoint override (OpenAI-compatible hosts). Blank leaves it unchanged.' })
  }
  if (spec.llm || hasLlmBlock(config, id)) out.push(...llmGroup(id))
  for (const f of spec.fields ?? []) {
    out.push({ path: `plugins.entries.${id}.${f.path}`, label: f.label, kind: f.type === 'boolean' ? 'boolean' : 'text', group: f.path.startsWith('llm.') ? 'llm' : 'config', help: f.help, placeholder: f.placeholder })
  }
  return out
}

function hasLlmBlock(config: Record<string, unknown> | undefined, id: string): boolean {
  const v = readPath(config, `plugins.entries.${id}.llm`)
  return !!v && typeof v === 'object'
}

// Resolve the fields to render for a plugin: gateway JSON Schema first (self-describing,
// no hardcoding), else the curated catalog. Falls back to [] (→ the Advanced raw tab).
export function fieldsFor(plugin: PluginConfigTarget, config?: Record<string, unknown>): FieldSpec[] {
  if (plugin.configSchema) {
    const fromSchema = jsonSchemaToFields(plugin.id, plugin.configSchema)
    if (fromSchema.length) return fromSchema
  }
  return curatedFields(plugin.id, config)
}

// ── JSON Schema → FieldSpec[] (guarded; only lights up when the gateway ships it) ──

export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  enum?: unknown[]
  default?: unknown
  description?: string
  format?: string
}

// Translate a plugin's manifest configSchema (describing the plugins.entries.<id> shape,
// with `config` / `llm` object subtrees) into flat FieldSpec[]. Handles scalar leaves one
// level under config/llm plus top-level scalars; nested objects/arrays are left to the raw
// editor. Absolute paths are rooted at plugins.entries.<id>.
export function jsonSchemaToFields(id: string, schema: JsonSchema): FieldSpec[] {
  const out: FieldSpec[] = []
  const props = schema.properties
  if (!props) return out
  const walk = (obj: JsonSchema, group: FieldGroup, prefix: string) => {
    const required = new Set(obj.required ?? [])
    for (const [key, p] of Object.entries(obj.properties ?? {})) {
      const path = `${prefix}.${key}`
      if (p.type === 'object' && p.properties) continue // nested-object: leave to raw editor
      if (p.type === 'array') continue
      out.push({
        path, group, label: humanize(key), kind: schemaKind(key, p),
        help: p.description, default: p.default,
        required: required.has(key),
        options: p.enum ? p.enum.map(String) : undefined,
      })
    }
  }
  for (const [key, p] of Object.entries(props)) {
    if ((key === 'config' || key === 'llm') && p.type === 'object' && p.properties) {
      walk(p, key === 'llm' ? 'llm' : 'config', `plugins.entries.${id}.${key}`)
    } else if (p.type !== 'object' && p.type !== 'array') {
      // top-level scalar → treat as config-level
      out.push({
        path: `plugins.entries.${id}.${key}`, group: 'config', label: humanize(key),
        kind: schemaKind(key, p), help: p.description, default: p.default,
        required: (schema.required ?? []).includes(key),
        options: p.enum ? p.enum.map(String) : undefined,
      })
    }
  }
  return out
}

function schemaKind(key: string, p: JsonSchema): FieldKind {
  if (p.enum) return 'enum'
  if (p.type === 'boolean') return 'boolean'
  if (p.type === 'number' || p.type === 'integer') return 'number'
  if (p.format === 'password' || /key|token|secret|password/i.test(key)) return 'secret'
  if (p.format === 'uri' || p.format === 'url' || /url|endpoint|baseurl/i.test(key)) return 'url'
  return 'text'
}

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

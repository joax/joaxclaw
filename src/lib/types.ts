// ── Openclaw Gateway Protocol ────────────────────────────────────────────────

export interface GwReqFrame {
  type: 'req'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface GwResFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: unknown
}

export interface GwEventFrame {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
  stateVersion?: number
}

export type GwFrame = GwReqFrame | GwResFrame | GwEventFrame

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Agent {
  id: string
  name?: string
  identity?: { name?: string; theme?: string; emoji?: string; avatar?: string; avatarUrl?: string }
  workspace?: string
  model?: { primary?: string; fallbacks?: string[] }
  agentRuntime?: { id: string; fallback?: 'pi' | 'none'; source: string }
  allowedSubAgents?: string[]
}

export interface AgentFile {
  filename: string
  size?: number
  updatedAt?: number
}

export interface Session {
  key: string
  sessionId?: string
  displayName?: string
  label?: string
  status?: string
  model?: string
  modelProvider?: string
  updatedAt?: number
  startedAt?: number
  hasActiveRun?: boolean
  // True while this session has yielded to a still-running sub-agent — the controller's
  // own hasActiveRun goes false during a yield, so this is what keeps it "live".
  hasActiveSubagentRun?: boolean
  isHeartbeat?: boolean
  contextTokens?: number   // context window limit (max capacity), not current usage
  inputTokens?: number    // cumulative input tokens across all runs in the session
  outputTokens?: number   // cumulative output tokens across all runs
  totalTokens?: number    // last-run input+output; best approximation of current context size
  estimatedCostUsd?: number  // gateway-computed cost estimate when available
  lastMessage?: string
}

export type MessageRole = 'user' | 'assistant' | 'system'

export interface MediaAttachment {
  type: 'audio' | 'image' | 'video'
  url?: string
  data?: string      // base64
  mediaType?: string
  name?: string
}

export interface ToolCall {
  id: string
  name: string
  args?: string
  result?: string
  status: 'pending' | 'running' | 'done' | 'error'
  durationMs?: number
  error?: string
  pluginId?: string
}

// A spawned sub-agent's conversation, captured inline as a collapsible "thread"
// anchored at the spawn point in the parent assistant message. The sub-agent runs in
// its own gateway session (childSessionKey); we route its live frames here via the
// frame's `spawnedBy` link to the parent session.
export interface SubThread {
  id: string                    // stable id: the sessions_spawn toolCallId, else the child session key
  childSessionKey?: string
  agentId?: string              // e.g. "research-worker", derived from the child session key
  task?: string                 // the brief the parent handed the sub-agent
  status: 'spawning' | 'running' | 'done' | 'error'
  content: string               // the sub-agent's streamed answer
  reasoning?: string
  toolCalls?: ToolCall[]
  resultPreview?: string        // one-line summary shown on the collapsed chip
  startedAt: string
  finishedAt?: string
  error?: string
}

export interface ContextOverflowInfo {
  provider?: string
  messages?: number
  compactionTokens?: number
  observedTokens?: number | string
  error: string
  diagId?: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  reasoning?: string
  reasoningStartedAt?: number   // ms epoch when the first reasoning token arrived
  reasoningDurationMs?: number  // frozen once the answer starts (drives "Thought for Ns")
  toolCalls?: ToolCall[]
  attachments?: MediaAttachment[]
  createdAt: string
  streaming?: boolean
  reasoningStreaming?: boolean
  waitingForSession?: string   // key of sub-session being awaited, if known
  threads?: SubThread[]        // spawned sub-agents, shown as inline expandable threads
  contextOverflow?: ContextOverflowInfo
  model?: string               // actual model used for this assistant message (provider/model or bare model id)
  interrupted?: boolean        // turn cut off by a gateway drop/restart; shows a live reconnect notice
}

// Per-chat thinking level. 'adaptive' (the default) means "no override" — let the
// agent/model decide. Other values map to the gateway's normalizeThinkLevel buckets.
export type ThinkingLevel = 'adaptive' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'off',      label: 'Off' },
  { value: 'minimal',  label: 'Minimal' },
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'xhigh',    label: 'Extra High' },
  { value: 'max',      label: 'Max' },
]

// What the user tells agents about themselves (Settings → You / first-run welcome).
// Injected as context on the first turn of a chat, and the name can stand in for the
// "JoaxClaw" sender label the model would otherwise see.
export interface UserProfile {
  name: string
  about: string
}

export interface Conversation {
  id: string
  sessionKey: string
  agentId: string
  agentName: string
  title: string
  lastMessage?: string
  lastAt?: string
  messages: ChatMessage[]
  // True while chat.history is being fetched for this conversation (esp. slow on a
  // remote gateway). Drives the loading state so tapping a chat gives instant feedback.
  loadingHistory?: boolean
  // Per-chat override for sharing the user profile as context: undefined follows the
  // global `shareProfile` setting; true/false forces it for this conversation.
  shareProfileOverride?: boolean
  // Per-chat overrides, independent of the agent's configured model.
  modelOverride?: string       // 'provider/model' — empty/undefined = agent default
  thinkingLevel?: ThinkingLevel // undefined / 'adaptive' = no override
}

// ── Connection ────────────────────────────────────────────────────────────────

export interface GatewayConnection {
  url: string
  token: string
  label?: string
  // Per-engine reachable URL overrides, keyed by the local-engine instance key
  // (provider id, or `<engine>:<port>` for port-detected instances). Used for health
  // checks when the gateway (and its engines) are remote. Empty = use the config URL.
  engineUrls?: Record<string, string>
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface GpuInfo {
  model: string
  utilizationGpu: number
  memUsed: number
  memTotal: number
  temperatureGpu: number
}

export interface SystemMetrics {
  cpu: number
  ramUsed: number
  ramTotal: number
  gpu: GpuInfo[]
}

export interface OllamaModel {
  name: string
  size: number
  loaded: boolean
  vramUsed?: number
}

// ── Crons ─────────────────────────────────────────────────────────────────────

export interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  at?: string
  everyMs?: number
  anchorMs?: number
  expr?: string
  tz?: string
  staggerMs?: number
}

export interface CronJobState {
  nextRunAtMs?: number
  runningAtMs?: number
  lastRunAtMs?: number
  lastRunStatus?: 'ok' | 'error' | 'skipped'
  lastError?: string
  lastDiagnosticSummary?: string
  lastErrorReason?: string
  lastDurationMs?: number
  consecutiveErrors?: number
  consecutiveSkipped?: number
  lastDeliveryStatus?: string
}

export interface CronPayloadSystemEvent {
  kind: 'systemEvent'
  text?: string
}

export interface CronPayloadAgentTurn {
  kind: 'agentTurn'
  message?: string
  model?: string
  fallbacks?: string[]
  lightContext?: boolean
  timeoutSeconds?: number
  thinking?: string
  toolsAllow?: string[] | null
  allowUnsafeExternalContent?: boolean
}

export type CronPayload = CronPayloadSystemEvent | CronPayloadAgentTurn

export interface CronDelivery {
  mode: 'none' | 'announce' | 'webhook'
  channel?: string
  to?: string
  threadId?: string | number
  accountId?: string
  bestEffort?: boolean
}

export interface CronJob {
  id: string
  name: string
  description?: string
  agentId?: string
  sessionKey?: string
  enabled: boolean
  deleteAfterRun?: boolean
  createdAtMs?: number
  updatedAtMs?: number
  schedule: CronSchedule
  sessionTarget: string
  wakeMode: string
  payload?: CronPayload
  delivery?: CronDelivery
  state: CronJobState
}

export interface CronRunEntry {
  ts: number
  jobId: string
  action: string
  status?: 'ok' | 'error' | 'skipped'
  error?: string
  errorReason?: string
  summary?: string
  durationMs?: number
  runAtMs?: number
  nextRunAtMs?: number
  sessionKey?: string
  model?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }
  jobName?: string
}

// ── Models (mirrors gateway config: models.providers) ─────────────────────────

export interface GwModelCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface GwModelCompat {
  supportsTools?: boolean
  supportsUsageInStreaming?: boolean
}

export interface GwModelDef {
  id: string
  name: string
  reasoning?: boolean
  input?: string[]            // e.g. ["text", "image"]
  cost?: GwModelCost
  contextWindow?: number
  maxTokens?: number
  compat?: GwModelCompat
  params?: Record<string, unknown>
}

// A credential may be a literal string or a SecretRef indirection
// ({ source: 'env', provider, id }) that points the gateway at a stored secret.
export interface SecretRef { source: string; provider?: string; id: string }

export interface GwModelProvider {
  baseUrl?: string
  api?: string
  apiKey?: string | SecretRef
  models: GwModelDef[]
}

// ── Theme ─────────────────────────────────────────────────────────────────────

export type BaseTheme = 'dark' | 'light' | 'system'
export type IconFamily = 'lucide' | 'heroicons' | 'phosphor' | 'tabler' | 'feather'

export interface ThemeColors {
  bgPrimary: string
  bgSurface: string
  bgElevated: string
  textPrimary: string
  textSecondary: string
  accent: string
  accentFg: string
  border: string
  danger: string
  success: string
  warning: string
}

// Per-surface background image. `file` is an absolute on-disk path (in userData, for
// custom/imported themes) — never the image bytes, so themes stay tiny in localStorage.
// Presets ship without backgrounds. Rendered as a layer behind the surface content.
export type ThemeBgSlot = 'app' | 'chat'
export type ThemeBgFit = 'cover' | 'contain' | 'tile'
export interface ThemeBackground {
  file: string          // absolute path on disk, or '' for none
  opacity: number       // 0..1
  blur: number          // px
  fit: ThemeBgFit
  position?: string     // CSS background-position (default 'center')
}

export interface ThemeSettings {
  id: string
  name: string
  base: BaseTheme
  colors: ThemeColors
  borderRadius: number
  fontSize: number
  fontFamily: string
  iconFamily: IconFamily
  author?: string
  backgrounds?: Partial<Record<ThemeBgSlot, ThemeBackground>>
}

// The built-in themes live as JSON files under /themes and are loaded via
// ../lib/presetThemes (PRESET_THEMES, DEFAULT_THEME) — a single source of truth.

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
  toolCalls?: ToolCall[]
  attachments?: MediaAttachment[]
  createdAt: string
  streaming?: boolean
  reasoningStreaming?: boolean
  waitingForSession?: string   // key of sub-session being awaited, if known
  contextOverflow?: ContextOverflowInfo
  model?: string               // actual model used for this assistant message (provider/model or bare model id)
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

export interface Conversation {
  id: string
  sessionKey: string
  agentId: string
  agentName: string
  title: string
  lastMessage?: string
  lastAt?: string
  messages: ChatMessage[]
  // Per-chat overrides, independent of the agent's configured model.
  modelOverride?: string       // 'provider/model' — empty/undefined = agent default
  thinkingLevel?: ThinkingLevel // undefined / 'adaptive' = no override
}

// ── Connection ────────────────────────────────────────────────────────────────

export interface GatewayConnection {
  url: string
  token: string
  label?: string
  // Optional explicit Ollama endpoints reachable from this client, used for health
  // checks when the gateway (and thus Ollama) is remote. Empty = derive/skip.
  ollamaUrls?: { main?: string; cron?: string }
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

export interface GwModelProvider {
  baseUrl?: string
  api?: string
  apiKey?: string
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

export interface ThemeSettings {
  id: string
  name: string
  base: BaseTheme
  colors: ThemeColors
  borderRadius: number
  fontSize: number
  fontFamily: string
  iconFamily: IconFamily
}

export const DARK_COLORS: ThemeColors = {
  bgPrimary: '#0f1117',
  bgSurface: '#1a1d2e',
  bgElevated: '#232640',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  accent: '#6366f1',
  accentFg: '#ffffff',
  border: '#2d3350',
  danger: '#ef4444',
  success: '#22c55e',
  warning: '#f59e0b'
}

export const LIGHT_COLORS: ThemeColors = {
  bgPrimary: '#f8fafc',
  bgSurface: '#ffffff',
  bgElevated: '#f1f5f9',
  textPrimary: '#0f172a',
  textSecondary: '#64748b',
  accent: '#6366f1',
  accentFg: '#ffffff',
  border: '#e2e8f0',
  danger: '#ef4444',
  success: '#16a34a',
  warning: '#d97706'
}

export const DEFAULT_THEME: ThemeSettings = {
  id: 'default-dark',
  name: 'Midnight',
  base: 'dark',
  colors: DARK_COLORS,
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'Inter, system-ui, sans-serif',
  iconFamily: 'lucide'
}

export const PRESET_THEMES: ThemeSettings[] = [
  DEFAULT_THEME,
  {
    id: 'ocean-dark',
    name: 'Ocean Dark',
    base: 'dark',
    colors: {
      ...DARK_COLORS,
      bgPrimary: '#0a1628',
      bgSurface: '#0f2040',
      bgElevated: '#163052',
      accent: '#38bdf8',
      border: '#1e3a5f'
    },
    borderRadius: 10,
    fontSize: 14,
    fontFamily: 'Inter, system-ui, sans-serif',
    iconFamily: 'lucide'
  },
  {
    id: 'rose-light',
    name: 'Rose Light',
    base: 'light',
    colors: {
      ...LIGHT_COLORS,
      accent: '#f43f5e',
      accentFg: '#ffffff'
    },
    borderRadius: 12,
    fontSize: 14,
    fontFamily: 'Inter, system-ui, sans-serif',
    iconFamily: 'lucide'
  },
  {
    id: 'forest-dark',
    name: 'Forest',
    base: 'dark',
    colors: {
      ...DARK_COLORS,
      bgPrimary: '#0c1a0f',
      bgSurface: '#122016',
      bgElevated: '#1a3020',
      accent: '#4ade80',
      accentFg: '#0a1a0c',
      border: '#1e3a26'
    },
    borderRadius: 6,
    fontSize: 14,
    fontFamily: 'Inter, system-ui, sans-serif',
    iconFamily: 'lucide'
  }
]

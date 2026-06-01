import { Server, Cloud } from 'lucide-react'

const LOCAL_PROVIDERS = new Set([
  'ollama', 'lmstudio', 'lm-studio', 'vllm', 'sglang', 'opencode',
  'opencode-go', 'synthetic', 'bonjour', 'vydra', 'zai', 'huggingface',
  'nvidia', 'microsoft-foundry',
])

// Returns true for models running on local hardware.
// Detects by provider prefix ("ollama/...") or Ollama-style tag ("qwen3:8b").
export function isLocalModel(model: string): boolean {
  if (!model) return false
  const slash = model.indexOf('/')
  if (slash > 0) return LOCAL_PROVIDERS.has(model.slice(0, slash).toLowerCase())
  // No provider prefix — Ollama bare model names use "name:tag" format
  return model.includes(':')
}

interface ModelIconProps {
  model: string
  size?: number
  style?: React.CSSProperties
}

export function ModelIcon({ model, size = 11, style }: ModelIconProps) {
  const local = isLocalModel(model)
  return local
    ? <Server size={size} style={{ color: 'var(--success)', opacity: 0.75, flexShrink: 0, ...style }} />
    : <Cloud   size={size} style={{ color: 'var(--accent)',  opacity: 0.75, flexShrink: 0, ...style }} />
}

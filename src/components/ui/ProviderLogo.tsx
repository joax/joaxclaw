import { PROVIDER_LOGOS } from '../../lib/providerLogos'

// A few provider-id / model-prefix spellings that don't match a logo key 1:1.
const ALIASES: Record<string, string> = {
  'x-ai': 'xai',
  'googleai': 'google',
  'google-gemini': 'gemini',
  'vertex': 'gemini',
  'vertexai': 'gemini',
  'meta-llama': 'meta',
  'azureopenai': 'azure-openai',
  'zhipu': 'zai',
  'z-ai': 'zai',
  'copilot': 'github-copilot',
}

const resolve = (id: string): string | undefined =>
  PROVIDER_LOGOS[id] ? id : (ALIASES[id] && PROVIDER_LOGOS[ALIASES[id]] ? ALIASES[id] : undefined)

// Normalize a provider id to a logo key (or undefined if we have no logo for it).
export function logoKeyFor(providerId: string | undefined): string | undefined {
  if (!providerId) return undefined
  const id = providerId.toLowerCase()
  const direct = resolve(id)
  if (direct) return direct
  // Detect a known provider as a token within a compound id — cron-isolated or
  // port-tagged engines come through as e.g. "ollama-cron" or "ollama:11434".
  for (const tok of id.split(/[-_:/.]+/)) {
    const hit = tok && resolve(tok)
    if (hit) return hit
  }
  return undefined
}

// Derive the provider from a chat model string. Models are "<provider>/<model>"
// (e.g. "openai/gpt-4o"); bare Ollama models use a "name:tag" form ("qwen3:8b").
export function providerFromModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const slash = model.indexOf('/')
  if (slash > 0) return model.slice(0, slash).toLowerCase()
  if (model.includes(':')) return 'ollama'
  return undefined
}

export function hasProviderLogo(providerId: string | undefined): boolean {
  return !!logoKeyFor(providerId)
}

interface ProviderLogoProps {
  // A provider id ("openai") or a full model string ("openai/gpt-4o").
  provider: string
  size?: number
  style?: React.CSSProperties
}

// A monocolor provider mark that inherits the surrounding text color (currentColor),
// so it works on any theme. Returns null when no logo is known for the provider.
export function ProviderLogo({ provider, size = 12, style }: ProviderLogoProps) {
  const key = logoKeyFor(provider) ?? logoKeyFor(providerFromModel(provider))
  const inner = key ? PROVIDER_LOGOS[key] : undefined
  if (!inner) return null
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size}
      fill="currentColor" fillRule="evenodd" aria-hidden
      style={{ flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}

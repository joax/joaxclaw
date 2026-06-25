// Curated catalog of popular Ollama models, for the "Discover" browser in the local
// model manager. There's no official Ollama library search API, so this is a
// hand-maintained list — enough to browse common models without knowing exact names;
// anything not here is still pullable via the free-text "pull by name" field.
//
// Sizes are approximate Q4 download sizes (GB) and meant for rough guidance, not exact.
// Pull name = `${id}:${variant.tag}`.

export type ModelCapability = 'tools' | 'vision' | 'reasoning' | 'code' | 'embedding'

export interface CatalogVariant { tag: string; params: string; sizeGB: number }

export interface CatalogModel {
  id: string            // ollama family id, e.g. 'llama3.2'
  name: string          // display name
  publisher: string
  blurb: string
  capabilities: ModelCapability[]
  variants: CatalogVariant[]
}

export const MODEL_CATALOG: CatalogModel[] = [
  { id: 'llama3.2', name: 'Llama 3.2', publisher: 'Meta', blurb: 'Small, fast general models with tool use.', capabilities: ['tools'],
    variants: [{ tag: '1b', params: '1B', sizeGB: 1.3 }, { tag: '3b', params: '3B', sizeGB: 2.0 }] },
  { id: 'llama3.1', name: 'Llama 3.1', publisher: 'Meta', blurb: 'Capable general-purpose models with tools.', capabilities: ['tools'],
    variants: [{ tag: '8b', params: '8B', sizeGB: 4.9 }, { tag: '70b', params: '70B', sizeGB: 40 }] },
  { id: 'llama3.2-vision', name: 'Llama 3.2 Vision', publisher: 'Meta', blurb: 'Multimodal Llama that can read images.', capabilities: ['vision'],
    variants: [{ tag: '11b', params: '11B', sizeGB: 7.9 }, { tag: '90b', params: '90B', sizeGB: 55 }] },
  { id: 'qwen2.5', name: 'Qwen 2.5', publisher: 'Alibaba', blurb: 'Strong multilingual models with tool use.', capabilities: ['tools'],
    variants: [{ tag: '0.5b', params: '0.5B', sizeGB: 0.4 }, { tag: '1.5b', params: '1.5B', sizeGB: 1.0 }, { tag: '3b', params: '3B', sizeGB: 1.9 }, { tag: '7b', params: '7B', sizeGB: 4.7 }, { tag: '14b', params: '14B', sizeGB: 9 }, { tag: '32b', params: '32B', sizeGB: 20 }, { tag: '72b', params: '72B', sizeGB: 47 }] },
  { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', publisher: 'Alibaba', blurb: 'Code-specialized Qwen, great for completion.', capabilities: ['code', 'tools'],
    variants: [{ tag: '1.5b', params: '1.5B', sizeGB: 1.0 }, { tag: '7b', params: '7B', sizeGB: 4.7 }, { tag: '14b', params: '14B', sizeGB: 9 }, { tag: '32b', params: '32B', sizeGB: 20 }] },
  { id: 'qwq', name: 'QwQ', publisher: 'Alibaba', blurb: 'Reasoning model that thinks before answering.', capabilities: ['reasoning'],
    variants: [{ tag: '32b', params: '32B', sizeGB: 20 }] },
  { id: 'deepseek-r1', name: 'DeepSeek-R1', publisher: 'DeepSeek', blurb: 'Open reasoning models with visible thinking.', capabilities: ['reasoning'],
    variants: [{ tag: '1.5b', params: '1.5B', sizeGB: 1.1 }, { tag: '7b', params: '7B', sizeGB: 4.7 }, { tag: '8b', params: '8B', sizeGB: 4.9 }, { tag: '14b', params: '14B', sizeGB: 9 }, { tag: '32b', params: '32B', sizeGB: 20 }, { tag: '70b', params: '70B', sizeGB: 43 }] },
  { id: 'gemma3', name: 'Gemma 3', publisher: 'Google', blurb: 'Efficient open models; larger sizes see images.', capabilities: ['vision'],
    variants: [{ tag: '1b', params: '1B', sizeGB: 0.8 }, { tag: '4b', params: '4B', sizeGB: 3.3 }, { tag: '12b', params: '12B', sizeGB: 8.1 }, { tag: '27b', params: '27B', sizeGB: 17 }] },
  { id: 'gemma2', name: 'Gemma 2', publisher: 'Google', blurb: 'Well-rounded small/medium open models.', capabilities: [],
    variants: [{ tag: '2b', params: '2B', sizeGB: 1.6 }, { tag: '9b', params: '9B', sizeGB: 5.4 }, { tag: '27b', params: '27B', sizeGB: 16 }] },
  { id: 'phi4', name: 'Phi-4', publisher: 'Microsoft', blurb: 'Small model strong at reasoning/math.', capabilities: ['reasoning'],
    variants: [{ tag: '14b', params: '14B', sizeGB: 9.1 }] },
  { id: 'phi3.5', name: 'Phi-3.5', publisher: 'Microsoft', blurb: 'Compact, capable instruct model.', capabilities: [],
    variants: [{ tag: '3.8b', params: '3.8B', sizeGB: 2.2 }] },
  { id: 'mistral', name: 'Mistral', publisher: 'Mistral AI', blurb: 'The classic fast 7B with tool use.', capabilities: ['tools'],
    variants: [{ tag: '7b', params: '7B', sizeGB: 4.1 }] },
  { id: 'mistral-nemo', name: 'Mistral Nemo', publisher: 'Mistral AI', blurb: '12B with a large context and tools.', capabilities: ['tools'],
    variants: [{ tag: '12b', params: '12B', sizeGB: 7.1 }] },
  { id: 'mixtral', name: 'Mixtral', publisher: 'Mistral AI', blurb: 'Mixture-of-experts; strong for its speed.', capabilities: ['tools'],
    variants: [{ tag: '8x7b', params: '8x7B', sizeGB: 26 }, { tag: '8x22b', params: '8x22B', sizeGB: 80 }] },
  { id: 'llava', name: 'LLaVA', publisher: 'Community', blurb: 'Popular vision-language model.', capabilities: ['vision'],
    variants: [{ tag: '7b', params: '7B', sizeGB: 4.7 }, { tag: '13b', params: '13B', sizeGB: 8 }, { tag: '34b', params: '34B', sizeGB: 20 }] },
  { id: 'codellama', name: 'Code Llama', publisher: 'Meta', blurb: 'Code generation and infilling.', capabilities: ['code'],
    variants: [{ tag: '7b', params: '7B', sizeGB: 3.8 }, { tag: '13b', params: '13B', sizeGB: 7.4 }, { tag: '34b', params: '34B', sizeGB: 19 }] },
  { id: 'command-r', name: 'Command R', publisher: 'Cohere', blurb: 'Tool-use & RAG-oriented model.', capabilities: ['tools'],
    variants: [{ tag: '35b', params: '35B', sizeGB: 20 }] },
  { id: 'smollm2', name: 'SmolLM2', publisher: 'Hugging Face', blurb: 'Tiny models for edge/low-resource use.', capabilities: [],
    variants: [{ tag: '135m', params: '135M', sizeGB: 0.3 }, { tag: '360m', params: '360M', sizeGB: 0.4 }, { tag: '1.7b', params: '1.7B', sizeGB: 1.1 }] },
  { id: 'nomic-embed-text', name: 'Nomic Embed Text', publisher: 'Nomic', blurb: 'High-quality text embeddings.', capabilities: ['embedding'],
    variants: [{ tag: 'latest', params: '137M', sizeGB: 0.3 }] },
  { id: 'mxbai-embed-large', name: 'mxbai Embed Large', publisher: 'Mixedbread', blurb: 'Strong embedding model.', capabilities: ['embedding'],
    variants: [{ tag: 'latest', params: '335M', sizeGB: 0.7 }] },
]

export const CAPABILITY_LABEL: Record<ModelCapability, string> = {
  tools: 'tools', vision: 'vision', reasoning: 'reasoning', code: 'code', embedding: 'embedding',
}

// Filter the catalog by a free-text query over name/id/publisher/capabilities.
export function searchCatalog(query: string): CatalogModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return MODEL_CATALOG
  return MODEL_CATALOG.filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.id.includes(q) ||
    m.publisher.toLowerCase().includes(q) ||
    m.capabilities.some(c => c.includes(q)),
  )
}

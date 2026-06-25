import { create } from 'zustand'

// Prompt-processing progress for the current Ollama run, parsed by the Electron
// main process from Ollama's logs and pushed over IPC. There is no request↔run
// correlation available in the logs, so this is "the current local run".

interface OllamaProgressEvent { nTokens: number; progress: number; tps: number }

interface OllamaApi {
  watch: () => Promise<{ ok: boolean }>
  onProgress: (cb: (p: OllamaProgressEvent) => void) => () => void
}

const ollamaApi = (): OllamaApi | undefined =>
  (window as unknown as { api?: { ollama?: OllamaApi } })?.api?.ollama

interface OllamaProgressState {
  progress: number | null   // 0..1, null when idle
  nTokens: number | null
  tps: number | null
  _started: boolean
  _timer: ReturnType<typeof setTimeout> | null
  // Idempotently starts the main-process log watcher and subscribes to events.
  ensureStarted: () => void
  // Clear the bar — called when the prompt-processing phase ends (the message
  // starts streaming output / the turn finishes), so it doesn't carry over.
  reset: () => void
}

export const useOllamaProgress = create<OllamaProgressState>((set, get) => ({
  progress: null,
  nTokens: null,
  tps: null,
  _started: false,
  _timer: null,

  ensureStarted() {
    if (get()._started) return
    const api = ollamaApi()
    if (!api) return  // not running under Electron (e.g. plain browser dev)
    set({ _started: true })
    api.watch().catch(() => {})
    api.onProgress(p => {
      const prev = get()._timer
      if (prev) clearTimeout(prev)
      // Clear shortly after prompt eval finishes (progress→1). Otherwise DON'T expire
      // on quiet — Ollama logs progress lines irregularly, and a >4s gap mid-eval must
      // not blank the bar. The component clears it via reset() when the phase ends; a
      // long safety timer only catches a truly abandoned run.
      const ttl = p.progress >= 0.999 ? 600 : 120_000
      const timer = setTimeout(
        () => set({ progress: null, nTokens: null, tps: null, _timer: null }),
        ttl
      )
      set({ progress: p.progress, nTokens: p.nTokens, tps: p.tps, _timer: timer })
    })
  },

  reset() {
    const t = get()._timer
    if (t) clearTimeout(t)
    set({ progress: null, nTokens: null, tps: null, _timer: null })
  },
}))

import { create } from 'zustand'
import type { ProcessDef } from '../lib/processParser'
import { parseProcessFile } from '../lib/processParser'
import { compileProcessToJob, buildLaunchPrompt } from '../lib/processCompiler'
import { gatewayClient } from '../lib/gateway'
import { nanoid } from '../lib/nanoid'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fileApi = () => (window as any)?.api?.file as {
  read:    (path: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  write:   (path: string, text: string) => Promise<{ ok: boolean; error?: string }>
  delete:  (path: string) => Promise<{ ok: boolean; error?: string }>
  listdir: (dir: string, ext?: string) => Promise<{ ok: boolean; files: { name: string; path: string }[]; error?: string }>
} | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const homedir = (): string => (window as any)?.api?.system?.homedir ?? '~'

export function processesDir(): string {
  return `${homedir()}/.openclaw/processes`
}

function runsDir(): string {
  return `${processesDir()}/.runs`
}

export type RunStatus = 'idle' | 'running' | 'done' | 'error'

export interface RunLogEntry {
  ts: number
  text: string
}

export interface ProcessRun {
  processId: string
  sessionKey?: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  currentAgent?: string
  stepsDone: number
  error?: string
  log: RunLogEntry[]
  outputBuffer: string
}

// ── Module-level session routing ──────────────────────────────────────────────
// Maps sessionKey → processId so the event handler can route gateway frames.
const _runSessions = new Map<string, string>()

// ── Persist run state to disk ─────────────────────────────────────────────────

async function persistRun(run: ProcessRun) {
  const api = fileApi()
  if (!api) return
  try {
    await api.write(`${runsDir()}/${run.processId}.json`, JSON.stringify(run, null, 2))
  } catch { /* non-critical */ }
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface ProcessesState {
  processes: ProcessDef[]
  runs: Record<string, ProcessRun>
  loading: boolean
  error: string | null
  _subscribed: boolean

  load:   () => Promise<void>
  reload: (path: string) => Promise<void>
  save:   (path: string, text: string) => Promise<boolean>
  delete: (path: string) => Promise<boolean>

  startRun: (processId: string, def: ProcessDef, controllerAgentId: string) => Promise<void>
  stopRun:  (processId: string) => Promise<void>

  _startEventListening: () => void
}

export const useProcessesStore = create<ProcessesState>((set, get) => ({
  processes: [],
  runs: {},
  loading: false,
  error: null,
  _subscribed: false,

  // ── Event subscription ────────────────────────────────────────────────────────

  _startEventListening() {
    if (get()._subscribed) return
    set({ _subscribed: true })

    gatewayClient.on((frame) => {
      // Detect process sessions created externally (e.g. via the process-builder skill).
      // The skill tags the session with label "process:<processId>" so we can link it.
      if (frame.event === 'sessions.changed') {
        const p = (frame.payload ?? {}) as Record<string, unknown>
        const sessionKey = String(p.sessionKey ?? p.key ?? '')
        const label      = String(p.label ?? '')
        if (!sessionKey || !label.startsWith('process:')) return
        if (_runSessions.has(sessionKey)) return  // already tracked

        const processId = label.slice('process:'.length)
        const def = get().processes.find(pr => pr.id === processId)
        if (!def) return

        _runSessions.set(sessionKey, processId)
        const now = Date.now()
        set(s => {
          const existing = s.runs[processId]
          if (existing?.status === 'running') return s
          return {
            runs: {
              ...s.runs,
              [processId]: {
                processId, sessionKey, status: 'running', startedAt: now,
                stepsDone: 0, outputBuffer: '',
                log: [{ ts: now, text: 'Process started via skill' }],
              },
            },
          }
        })
        return
      }

      if (frame.event !== 'chat' && frame.event !== 'agent') return
      const p = (frame.payload ?? {}) as Record<string, unknown>
      const sk = String(p.sessionKey ?? '')
      const processId = _runSessions.get(sk)
      if (!processId) return

      const now = Date.now()

      // agent event: detect sessions_spawn tool calls to track active sub-agent
      if (frame.event === 'agent') {
        const data = p.data as Record<string, unknown> | undefined
        if (p.stream === 'tool' && data?.phase === 'start' && data?.name === 'sessions_spawn') {
          const args = data.args as Record<string, unknown> | undefined
          const subName = String(args?.taskName ?? args?.agentId ?? 'sub-agent')
          set(s => {
            const run = s.runs[processId]
            if (!run) return s
            return { runs: { ...s.runs, [processId]: { ...run, currentAgent: subName } } }
          })
        }
        return
      }

      // chat events
      const state = String(p.state ?? '')

      if (state === 'delta' && p.deltaText) {
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          return { runs: { ...s.runs, [processId]: { ...run, outputBuffer: run.outputBuffer + String(p.deltaText) } } }
        })
        return
      }

      if (state === 'waiting' || state === 'delegating') {
        const subKey = String(p.waitingSessionKey ?? p.subSessionKey ?? '')
        const entry: RunLogEntry = { ts: now, text: `Delegating to ${subKey || 'sub-agent'}` }
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          return {
            runs: {
              ...s.runs,
              [processId]: {
                ...run,
                currentAgent: subKey || run.currentAgent,
                stepsDone: run.stepsDone + 1,
                outputBuffer: '',
                log: [...run.log, entry],
              },
            },
          }
        })
        return
      }

      if (state === 'final') {
        _runSessions.delete(sk)
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          const updated: ProcessRun = {
            ...run, status: 'done', finishedAt: now, currentAgent: undefined,
            log: [...run.log, { ts: now, text: 'Process completed' }],
          }
          persistRun(updated)
          return { runs: { ...s.runs, [processId]: updated } }
        })
        return
      }

      if (state === 'error') {
        _runSessions.delete(sk)
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          const updated: ProcessRun = {
            ...run, status: 'error', finishedAt: now, currentAgent: undefined,
            error: String(p.errorMessage ?? 'Unknown error'),
            log: [...run.log, { ts: now, text: `Error: ${String(p.errorMessage ?? 'unknown')}` }],
          }
          persistRun(updated)
          return { runs: { ...s.runs, [processId]: updated } }
        })
        return
      }

      if (state === 'aborted') {
        _runSessions.delete(sk)
        set(s => {
          const run = s.runs[processId]
          if (!run) return s
          const updated: ProcessRun = {
            ...run, status: 'idle', finishedAt: now, currentAgent: undefined,
            log: [...run.log, { ts: now, text: 'Process stopped' }],
          }
          persistRun(updated)
          return { runs: { ...s.runs, [processId]: updated } }
        })
      }
    })
  },

  // ── Run actions ───────────────────────────────────────────────────────────────

  async startRun(processId, def, controllerAgentId) {
    get()._startEventListening()

    let sessionKey: string
    try {
      const res = await gatewayClient.request<{ key: string }>('sessions.create', { agentId: controllerAgentId })
      sessionKey = res.key
    } catch (e) {
      const now = Date.now()
      set(s => ({
        runs: {
          ...s.runs,
          [processId]: {
            processId, status: 'error', startedAt: now, finishedAt: now,
            stepsDone: 0, outputBuffer: '', error: String(e),
            log: [{ ts: now, text: `Failed to create session: ${String(e)}` }],
          },
        },
      }))
      return
    }

    _runSessions.set(sessionKey, processId)

    const now = Date.now()
    set(s => ({
      runs: {
        ...s.runs,
        [processId]: {
          processId, sessionKey, status: 'running', startedAt: now,
          stepsDone: 0, outputBuffer: '',
          log: [{ ts: now, text: `Session created: ${sessionKey}` }],
        },
      },
    }))

    const job    = compileProcessToJob(def)
    const prompt = buildLaunchPrompt(def, job)

    try {
      await gatewayClient.request('chat.send', { sessionKey, message: prompt, idempotencyKey: nanoid(16) })
      set(s => {
        const run = s.runs[processId]
        if (!run) return s
        return { runs: { ...s.runs, [processId]: { ...run, log: [...run.log, { ts: Date.now(), text: 'Prompt sent — Team Lead is executing…' }] } } }
      })
    } catch (e) {
      _runSessions.delete(sessionKey)
      set(s => {
        const run = s.runs[processId]
        if (!run) return s
        const updated: ProcessRun = {
          ...run, status: 'error', finishedAt: Date.now(), error: String(e),
          log: [...run.log, { ts: Date.now(), text: `Failed to send prompt: ${String(e)}` }],
        }
        persistRun(updated)
        return { runs: { ...s.runs, [processId]: updated } }
      })
    }
  },

  async stopRun(processId) {
    const run = get().runs[processId]
    if (!run?.sessionKey) return
    try {
      await gatewayClient.request('sessions.abort', { key: run.sessionKey })
    } catch { /* event handler will update state on aborted event */ }
  },

  // ── File operations ───────────────────────────────────────────────────────────

  async load() {
    get()._startEventListening()  // ensure we catch externally-started processes
    set({ loading: true, error: null })
    const api = fileApi()
    if (!api) { set({ loading: false, error: 'File API not available' }); return }

    try {
      const { ok, files, error } = await api.listdir(processesDir(), '.md')
      if (!ok) { set({ loading: false, error: error ?? 'Failed to list processes' }); return }

      const defs: ProcessDef[] = []
      for (const f of files) {
        const res = await api.read(f.path)
        if (!res.ok || !res.text) continue
        const def = parseProcessFile(f.path, res.text)
        if (def) defs.push(def)
      }

      // Restore persisted run states
      const restoredRuns: Record<string, ProcessRun> = {}
      const runsResult = await api.listdir(runsDir(), '.json').catch(() => ({ ok: false as const, files: [] }))
      if (runsResult.ok) {
        for (const f of runsResult.files) {
          try {
            const res = await api.read(f.path)
            if (!res.ok || !res.text) continue
            const run = JSON.parse(res.text) as ProcessRun
            if (run.status === 'running') {
              run.status = 'error'
              run.error = 'Interrupted — app was restarted'
              run.finishedAt = Date.now()
            }
            restoredRuns[run.processId] = run
          } catch { /* skip corrupt run files */ }
        }
      }

      set({ processes: defs, runs: restoredRuns, loading: false })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  async reload(path) {
    const api = fileApi()
    if (!api) return
    const res = await api.read(path)
    if (!res.ok || !res.text) return
    const def = parseProcessFile(path, res.text)
    if (!def) return
    set(s => ({
      processes: s.processes.some(p => p.path === path)
        ? s.processes.map(p => p.path === path ? def : p)
        : [...s.processes, def],
    }))
  },

  async save(path, text) {
    const api = fileApi()
    if (!api) return false
    const res = await api.write(path, text)
    if (!res.ok) return false
    await get().reload(path)
    return true
  },

  async delete(path) {
    const api = fileApi()
    if (!api || typeof api.delete !== 'function') {
      set({ error: 'Delete not available — please restart the app' })
      return false
    }
    try {
      const res = await api.delete(path)
      if (!res.ok) { set({ error: res.error ?? 'Failed to delete process' }); return false }
      set(s => ({ processes: s.processes.filter(p => p.path !== path), error: null }))
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    }
  },
}))

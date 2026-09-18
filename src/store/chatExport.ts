import { create } from 'zustand'
import { DEFAULT_EXPORT_OPTIONS, type ExportFormat, type ExportOptions } from '../lib/chatExport'

// Which chat the export dialog is open for (PRD 05), and the export choices remembered on
// this device. The dialog can open from the chat header or from a chat-list row, which
// needn't be the open chat, so it's keyed by session rather than by conversation.

export interface ExportTarget {
  sessionKey: string
  title: string
}

const PREFS_KEY = 'joaxclaw-export-options'

export interface ExportPrefs extends ExportOptions { format: ExportFormat }

// Per-device convenience only: a blocked or private-mode storage just means defaults.
function loadPrefs(): ExportPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ExportPrefs> | null
    return {
      format: raw?.format === 'json' ? 'json' : 'md',
      tools: typeof raw?.tools === 'boolean' ? raw.tools : DEFAULT_EXPORT_OPTIONS.tools,
      reasoning: typeof raw?.reasoning === 'boolean' ? raw.reasoning : DEFAULT_EXPORT_OPTIONS.reasoning,
      timestamps: typeof raw?.timestamps === 'boolean' ? raw.timestamps : DEFAULT_EXPORT_OPTIONS.timestamps,
    }
  } catch {
    return { format: 'md', ...DEFAULT_EXPORT_OPTIONS }
  }
}

interface ChatExportState {
  target: ExportTarget | null
  prefs: ExportPrefs
  open: (target: ExportTarget) => void
  close: () => void
  setPrefs: (patch: Partial<ExportPrefs>) => void
}

export const useChatExportStore = create<ChatExportState>((set, get) => ({
  target: null,
  prefs: loadPrefs(),
  open: target => set({ target }),
  close: () => set({ target: null }),
  setPrefs: patch => {
    const prefs = { ...get().prefs, ...patch }
    set({ prefs })
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* not persisted this time */ }
  },
}))

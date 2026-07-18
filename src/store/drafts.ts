import { create } from 'zustand'
import type { AttachmentKind } from '../lib/attachments'

export interface PendingAttachment {
  id: string
  name: string
  mediaType: string
  dataUrl: string
  base64: string
  size: number
  type: AttachmentKind
}

interface Draft {
  text: string
  attachments: PendingAttachment[]
}

interface DraftsState {
  drafts: Record<string, Draft>
  setText: (convId: string, text: string) => void
  setAttachments: (convId: string, attachments: PendingAttachment[]) => void
  clear: (convId: string) => void
  get: (convId: string) => Draft
}

const EMPTY: Draft = { text: '', attachments: [] }

export const useDraftsStore = create<DraftsState>((set, get) => ({
  drafts: {},

  setText: (convId, text) =>
    set(s => ({
      drafts: {
        ...s.drafts,
        [convId]: { ...(s.drafts[convId] ?? EMPTY), text },
      },
    })),

  setAttachments: (convId, attachments) =>
    set(s => ({
      drafts: {
        ...s.drafts,
        [convId]: { ...(s.drafts[convId] ?? EMPTY), attachments },
      },
    })),

  clear: (convId) =>
    set(s => {
      const next = { ...s.drafts }
      delete next[convId]
      return { drafts: next }
    }),

  get: (convId) => get().drafts[convId] ?? EMPTY,
}))

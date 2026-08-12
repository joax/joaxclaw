import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { gatewayClient } from '../lib/gateway'

// Files the gateway's agents wrote — the drawer's state, plus the selection shared by
// every zoom level of the viewer (card → drawer → full → pop-out window).
//
// Listing needs the joaxclaw-fs `host.files.*` RPC: on a REMOTE gateway the files are
// on the host, and even on a LOCAL one the plugin is what knows which directories count
// as roots. Without the plugin the drawer shows the install notice — but artifact cards
// in chat still work, because those read a known path through host.readMedia / local fs.
// See docs/files-drawer.md.

export interface FileRoot {
  id: string
  label: string
  path: string
  agentId?: string
}

export interface FileEntry {
  name: string
  path: string
  size: number
  mtimeMs: number
  isDir: boolean
}

export interface FileSelection {
  path: string
  name?: string
}

interface FilesState {
  // Viewer
  open: boolean
  expanded: boolean
  selected: FileSelection | null

  // Listing
  roots: FileRoot[]
  rootId: string | null
  subdir: string
  entries: FileEntry[]
  loading: boolean
  error: string
  /** null = not probed yet; false = the host has no host.files.* (old/absent plugin). */
  supported: boolean | null
  /** Timestamp of the last time the drawer was opened — drives the "new" markers. */
  seenAtMs: number

  openFile: (sel: FileSelection) => void
  openDrawer: () => void
  closeDrawer: () => void
  toggleExpand: () => void
  clearSelection: () => void
  loadRoots: () => Promise<void>
  selectRoot: (rootId: string, subdir?: string) => Promise<void>
  refresh: () => Promise<void>
}

const isUnknownMethod = (e: unknown): boolean =>
  /unknown method/i.test(e instanceof Error ? e.message : String(e))

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const useFilesStore = create<FilesState>()(
  persist(
    (set, get) => ({
      open: false,
      expanded: false,
      selected: null,
      roots: [],
      rootId: null,
      subdir: '',
      entries: [],
      loading: false,
      error: '',
      supported: null,
      seenAtMs: 0,

      openFile(sel) {
        set({ selected: sel, open: true })
      },

      openDrawer() {
        // The Files button opens the *panel*; only a card opens a specific file. Without
        // clearing this, reopening jumped straight back into whatever was last previewed
        // — including a file that has since been deleted.
        set({ open: true, selected: null })
        void get().loadRoots()
      },

      closeDrawer() {
        // Leaving the drawer marks everything seen, so the "new" dots reflect what has
        // arrived since the user last actually looked.
        set({ open: false, expanded: false, seenAtMs: Date.now() })
      },

      toggleExpand() { set(s => ({ expanded: !s.expanded })) },

      clearSelection() { set({ selected: null, expanded: false }) },

      async loadRoots() {
        if (get().roots.length && get().supported) return
        set({ loading: true, error: '' })
        try {
          const r = await gatewayClient.request<{ roots?: FileRoot[] }>('host.files.roots', {}, 8000)
          const roots = r.roots ?? []
          set({ roots, supported: true, loading: false })
          const first = get().rootId && roots.some(x => x.id === get().rootId) ? get().rootId! : roots[0]?.id
          if (first) await get().selectRoot(first)
          else set({ entries: [] })
        } catch (e) {
          if (isUnknownMethod(e)) {
            set({ supported: false, loading: false, roots: [], entries: [] })
          } else {
            set({ loading: false, error: errText(e), supported: get().supported })
          }
        }
      },

      async selectRoot(rootId, subdir = '') {
        set({ rootId, subdir, loading: true, error: '', entries: [] })
        try {
          const r = await gatewayClient.request<{ entries?: FileEntry[] }>('host.files.list', {
            root: rootId, subdir,
          }, 15000)
          set({ entries: r.entries ?? [], loading: false })
        } catch (e) {
          if (isUnknownMethod(e)) set({ supported: false, loading: false })
          else set({ loading: false, error: errText(e) })
        }
      },

      async refresh() {
        const { rootId, subdir } = get()
        if (rootId) await get().selectRoot(rootId, subdir)
        else await get().loadRoots()
      },
    }),
    {
      name: 'joaxclaw-files',
      // Only the durable bits: what the user was looking at and when they last looked.
      // Entries and probe results are re-read per connection — a different gateway has
      // different files, and a stale `supported:true` would hide the install notice.
      partialize: s => ({ rootId: s.rootId, seenAtMs: s.seenAtMs }),
    },
  ),
)

export interface Crumb { label: string; subdir: string }

/**
 * Trail from a root down to the current subdirectory. The first crumb is the root
 * itself (`subdir: ''`), which is what gets the user back out — without it, walking
 * into a folder is a one-way trip on a gateway with a single root.
 */
export function breadcrumbFor(rootLabel: string, subdir: string): Crumb[] {
  const parts = subdir.split('/').filter(Boolean)
  return [
    { label: rootLabel, subdir: '' },
    ...parts.map((name, i) => ({ label: name, subdir: parts.slice(0, i + 1).join('/') })),
  ]
}

/** Files newer than the last drawer visit — drives the "new" dot and the nav badge. */
export function newSince(entries: FileEntry[], seenAtMs: number): FileEntry[] {
  if (!seenAtMs) return []
  return entries.filter(e => !e.isDir && e.mtimeMs > seenAtMs)
}

/** Reset per-connection state when switching gateways (different host, different files). */
export function resetFilesForConnection(): void {
  useFilesStore.setState({
    roots: [], entries: [], rootId: null, subdir: '', supported: null, error: '', selected: null,
  })
}

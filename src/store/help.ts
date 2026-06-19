import { create } from 'zustand'

export type HelpTab = 'start' | 'shortcuts' | 'gateways' | 'remote-teams' | 'troubleshooting' | 'about'

// Global control for the Help modal so it can be opened from anywhere
// (nav rail, settings callouts, etc.), optionally deep-linked to a tab.
interface HelpState {
  open: boolean
  tab: HelpTab
  openHelp: (tab?: HelpTab) => void
  closeHelp: () => void
}

export const useHelpStore = create<HelpState>((set) => ({
  open: false,
  tab: 'start',
  openHelp: (tab) => set(tab ? { open: true, tab } : { open: true }),
  closeHelp: () => set({ open: false }),
}))

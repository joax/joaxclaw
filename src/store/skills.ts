import { create } from 'zustand'
import { installNativeSkills, type SkillResult } from '../lib/skillInstall'

// Tracks installation of the app-native agent skills onto the current gateway.
interface SkillsInstallState {
  results: SkillResult[]
  running: boolean
  ranForUrl: string | null
  run: (gatewayUrl: string | undefined, force?: boolean) => Promise<void>
}

export const useSkillsStore = create<SkillsInstallState>((set) => ({
  results: [],
  running: false,
  ranForUrl: null,

  async run(gatewayUrl, force = false) {
    set({ running: true })
    try {
      const results = await installNativeSkills(gatewayUrl, force)
      set({ results, ranForUrl: gatewayUrl ?? null })
    } catch (e) {
      set({ results: [{ slug: 'app skills', status: 'error', error: String(e) }] })
    } finally {
      set({ running: false })
    }
  },
}))

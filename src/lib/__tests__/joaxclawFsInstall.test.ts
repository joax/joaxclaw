import { describe, it, expect } from 'vitest'
import { buildPluginInstallPrompt } from '../joaxclawFsInstall'

describe('buildPluginInstallPrompt', () => {
  it('emits the hardened install script', async () => {
    const { ok, prompt } = await buildPluginInstallPrompt()
    expect(ok).toBe(true)
    const p = prompt ?? ''
    // Real, hardened commands.
    expect(p).toContain('set -e')
    expect(p).toContain('openclaw plugins install --force openclaw-joaxclaw-fs')
    expect(p).toContain('openclaw plugins enable joaxclaw-fs')
    expect(p).toContain('openclaw plugins inspect joaxclaw-fs')   // verify guard before restart
    expect(p).toContain('openclaw gateway restart')
  })

  it('never uses the invalid `plugins allow` subcommand', async () => {
    const { prompt } = await buildPluginInstallPrompt()
    expect(prompt ?? '').not.toMatch(/plugins\s+allow/)
  })
})

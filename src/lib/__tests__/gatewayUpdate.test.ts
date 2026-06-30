import { describe, it, expect } from 'vitest'
import { buildGatewayUpdatePrompt } from '../gatewayUpdate'

describe('buildGatewayUpdatePrompt', () => {
  it('emits the hardened update script', async () => {
    const { ok, prompt } = await buildGatewayUpdatePrompt()
    expect(ok).toBe(true)
    const p = prompt ?? ''
    // Real, hardened commands.
    expect(p).toContain('set -e')
    expect(p).toContain('openclaw update --yes --no-restart')
    expect(p).toContain('openclaw gateway restart')
  })

  it('defers the restart so the agent turn finishes before the gateway drops', async () => {
    const { prompt } = await buildGatewayUpdatePrompt()
    const p = prompt ?? ''
    // Update must skip its own restart, and the restart we trigger is detached + delayed.
    expect(p).toContain('--no-restart')
    expect(p).toMatch(/nohup sh -c 'sleep \d+; openclaw gateway restart'/)
  })
})

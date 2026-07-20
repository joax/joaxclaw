import { describe, it, expect } from 'vitest'
import { isCronSessionKey, agentIdFromSessionKey } from '../sessionName'

describe('isCronSessionKey', () => {
  it('matches scheduled cron run keys', () => {
    expect(isCronSessionKey('agent:main:cron:50ede109-fcbb-4e25-b021-2b819baacd98')).toBe(true)
    expect(isCronSessionKey('agent:research-worker:cron:abc')).toBe(true)
  })

  it('does not match real chats or other kinds', () => {
    expect(isCronSessionKey('agent:main:main')).toBe(false)
    expect(isCronSessionKey('agent:main:subagent:abc')).toBe(false)
    expect(isCronSessionKey('agent:main:dashboard:abc')).toBe(false)
    expect(isCronSessionKey('agent:personal-assistant:whatsapp:direct:+14152651386')).toBe(false)
  })
})

describe('agentIdFromSessionKey', () => {
  it('recovers the agent id from the standard key shape', () => {
    expect(agentIdFromSessionKey('agent:main:cron:xyz')).toBe('main')
    expect(agentIdFromSessionKey('agent:research-worker:subagent:xyz')).toBe('research-worker')
  })
})

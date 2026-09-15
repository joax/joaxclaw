import { describe, it, expect } from 'vitest'
import {
  CHANNELS, channelDef, initialMode, fieldsForMode, buildCredentialSettings,
  pluginInstallState, pluginInstallCommand,
} from '../channels'

// Adding Slack failed on OpenClaw 2026.9.4 for two reasons. Slack (like almost every
// channel there) is now a plugin that has to be installed first, and the form didn't
// know. The form also demanded an app-level token even for HTTP mode, which doesn't use
// one, and never saved the mode.

const slack = channelDef('slack')

describe('Slack modes', () => {
  it('Socket Mode asks for the bot and app-level tokens', () => {
    expect(fieldsForMode(slack, 'socket').map(f => f.key)).toEqual(['botToken', 'appToken'])
  })

  it('HTTP asks for the bot token and signing secret, plus an optional events path', () => {
    expect(fieldsForMode(slack, 'http').map(f => f.key)).toEqual(['botToken', 'signingSecret', 'webhookPath'])
  })

  it('opens in the saved mode, and otherwise in Socket Mode', () => {
    expect(initialMode(slack, {})).toBe('socket')
    expect(initialMode(slack, { mode: 'http' })).toBe('http')
    expect(initialMode(slack, { mode: 'bogus' })).toBe('socket')
    // Saved before the form wrote a mode: a signing secret without an app token is HTTP.
    expect(initialMode(slack, { signingSecret: 's', botToken: 'xoxb-1' })).toBe('http')
  })

  it('has no mode for channels without modes', () => {
    expect(initialMode(channelDef('telegram'), {})).toBeUndefined()
  })
})

describe('buildCredentialSettings', () => {
  it('saves Socket Mode with both tokens and the mode', () => {
    expect(buildCredentialSettings(slack, 'socket', { botToken: 'xoxb-1', appToken: 'xapp-1' }, {}))
      .toEqual({ settings: { botToken: 'xoxb-1', appToken: 'xapp-1', mode: 'socket' } })
  })

  it('saves HTTP without an app-level token', () => {
    expect(buildCredentialSettings(slack, 'http', { botToken: 'xoxb-1', signingSecret: 'sig' }, {}))
      .toEqual({ settings: { botToken: 'xoxb-1', signingSecret: 'sig', mode: 'http' } })
  })

  it("names the missing field and the mode it's missing for", () => {
    expect(buildCredentialSettings(slack, 'http', { botToken: 'xoxb-1' }, {}))
      .toEqual({ error: 'Signing secret is required for HTTP Request URL.' })
    expect(buildCredentialSettings(slack, 'socket', { botToken: 'xoxb-1' }, {}))
      .toEqual({ error: 'App-level token is required for Socket Mode.' })
  })

  it('catches a token pasted into the wrong field', () => {
    expect(buildCredentialSettings(slack, 'socket', { botToken: 'xapp-1', appToken: 'xoxb-1' }, {}))
      .toEqual({ error: 'Bot token: Bot tokens start with xoxb-.' })
    expect(buildCredentialSettings(slack, 'socket', { botToken: 'xoxb-1', appToken: 'xoxp-1' }, {}))
      .toEqual({ error: 'App-level token: App-level tokens start with xapp-.' })
  })

  it('keeps an untouched SecretRef', () => {
    const ref = { source: 'env', provider: 'default', id: 'SLACK_APP_TOKEN' }
    expect(buildCredentialSettings(slack, 'socket', { botToken: 'xoxb-1', appToken: '' }, { appToken: ref }))
      .toEqual({ settings: { botToken: 'xoxb-1', appToken: ref, mode: 'socket' } })
  })

  it("doesn't write a mode for channels without modes", () => {
    expect(buildCredentialSettings(channelDef('telegram'), undefined, { botToken: '123:abc' }, {}))
      .toEqual({ settings: { botToken: '123:abc' } })
  })
})

describe('channel plugins', () => {
  it('every channel except Telegram names its plugin (OpenClaw 2026.9)', () => {
    const without = CHANNELS.filter(c => !c.plugin).map(c => c.id)
    expect(without).toEqual(['telegram'])
  })

  it('official plugins install as @openclaw/<id>', () => {
    for (const c of CHANNELS.filter(c => c.plugin?.official)) {
      expect(c.plugin?.spec).toBe(`@openclaw/${c.plugin?.id}`)
    }
    expect(pluginInstallCommand(slack.plugin!)).toBe('openclaw plugins install @openclaw/slack')
  })

  it('has no command when the package is unknown', () => {
    expect(pluginInstallCommand(channelDef('wechat').plugin!)).toBeNull()
  })
})

describe('pluginInstallState', () => {
  const plugin = slack.plugin!

  it('installed and enabled', () => {
    expect(pluginInstallState({ plugins: [{ id: 'slack', installed: true, enabled: true, state: 'enabled' }] }, plugin)).toBe('installed')
  })

  it('listed but not installed: the catalog lists plugins you could install', () => {
    expect(pluginInstallState({ plugins: [{ id: 'slack', installed: false, enabled: false, state: 'not-installed' }] }, plugin)).toBe('missing')
  })

  it('installed but switched off', () => {
    expect(pluginInstallState({ plugins: [{ id: 'slack', installed: true, enabled: false, state: 'disabled' }] }, plugin)).toBe('disabled')
  })

  it('matches by package name too', () => {
    expect(pluginInstallState({ plugins: [{ id: 'other', packageName: '@openclaw/slack', installed: true, enabled: true }] }, plugin)).toBe('installed')
  })

  it("treats an older gateway's list entry, which has no installed flag, as installed", () => {
    expect(pluginInstallState({ plugins: [{ id: 'slack', enabled: true }] }, plugin)).toBe('installed')
  })

  it('missing when absent, or when the result is junk', () => {
    expect(pluginInstallState({ plugins: [{ id: 'discord', installed: true }] }, plugin)).toBe('missing')
    expect(pluginInstallState(null, plugin)).toBe('missing')
  })
})

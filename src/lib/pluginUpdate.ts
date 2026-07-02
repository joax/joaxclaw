import { buildPluginInstallPrompt } from './joaxclawFsInstall'
import { sendViaAgent } from './agentPrompt'

// Detecting + applying updates for the bundled joaxclaw-fs gateway plugin: compare the
// installed version (from plugins.list) against the latest published on npm, and offer
// to upgrade via the same agent-run `plugins install --force` flow used to install it.

export const PLUGIN_ID = 'joaxclaw-fs'
export const NPM_PLUGIN = 'openclaw-joaxclaw-fs'

// Parse "1.2.3" (ignoring any prerelease/build suffix) into numeric parts.
function parseSemver(v: string | undefined): [number, number, number] | null {
  if (!v) return null
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

// -1 if a<b, 0 if equal, 1 if a>b. Unparseable versions sort as 0 (no update prompt).
export function compareSemver(a: string | undefined, b: string | undefined): number {
  const pa = parseSemver(a), pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

// True when `latest` is a strictly newer release than the `installed` version.
export function isUpdateAvailable(installed: string | undefined, latest: string | undefined): boolean {
  return !!installed && !!latest && compareSemver(latest, installed) > 0
}

// Fetch the latest published version of the plugin from the npm registry, via the
// main-process fetch (avoids renderer CORS). Returns null on any failure.
export async function fetchLatestPluginVersion(): Promise<string | null> {
  const api = (window as unknown as { api?: { ollama?: { fetch?: (url: string) => Promise<{ ok: boolean; body: string }> } } }).api?.ollama
  if (!api?.fetch) return null
  try {
    const res = await api.fetch(`https://registry.npmjs.org/${NPM_PLUGIN}/latest`)
    if (!res?.ok || !res.body) return null
    const j = JSON.parse(res.body) as { version?: string }
    return typeof j.version === 'string' ? j.version : null
  } catch {
    return null
  }
}

// Kick off an in-app update: ask an agent on the gateway host to force-reinstall the
// latest plugin from npm and restart the gateway. `onOpenChat` navigates to the chat so
// the user can watch/approve. Returns false if the install prompt couldn't be built.
export async function startPluginUpdate(onOpenChat?: () => void): Promise<boolean> {
  const built = await buildPluginInstallPrompt()
  if (!built.ok || !built.prompt) return false
  sendViaAgent(built.prompt, onOpenChat)
  return true
}

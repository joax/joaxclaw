import { gatewayClient } from './gateway'
import { gatewayHost, isLocalGateway } from './ollamaHealth'

// Installs the app-native agent skills (process-builder, teams-blueprint) onto the
// connected gateway. Local gateways get a direct file write; remote gateways get an
// upload over the existing WebSocket via skills.upload.* + skills.install.

export type SkillStatus = 'installed' | 'up-to-date' | 'error'
export interface SkillResult { slug: string; status: SkillStatus; error?: string }

interface NativeSkill { slug: string; version: number }
interface BuildResult { ok: boolean; slug?: string; version?: number; base64?: string; sha256?: string; sizeBytes?: number; error?: string }

interface SkillsApi {
  installNative: (force?: boolean) => Promise<{ ok: boolean; results: SkillResult[] }>
  listNative: () => Promise<NativeSkill[]>
  buildArchive: (slug: string) => Promise<BuildResult>
}
const skillsApi = (): SkillsApi | undefined =>
  (window as unknown as { api?: { skills?: SkillsApi } })?.api?.skills

// ── Per-gateway memory of which skill versions we've pushed (avoids re-uploading) ──

const MEMORY_KEY = 'joaxclaw-remote-skills'
type Memory = Record<string, Record<string, number>>  // gatewayUrl -> slug -> version

function readMemory(): Memory {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') } catch { return {} }
}
function installedVersion(gatewayUrl: string, slug: string): number | undefined {
  return readMemory()[gatewayUrl]?.[slug]
}
function rememberInstalled(gatewayUrl: string, slug: string, version: number) {
  const mem = readMemory()
  mem[gatewayUrl] = { ...(mem[gatewayUrl] ?? {}), [slug]: version }
  localStorage.setItem(MEMORY_KEY, JSON.stringify(mem))
}

function cleanError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  // Gateway errors arrive JSON-stringified; surface the message if present.
  try {
    const parsed = JSON.parse(s) as { message?: string }
    if (parsed?.message) return parsed.message
  } catch { /* not JSON */ }
  return s
}

// ── Remote install via gateway RPCs ───────────────────────────────────────────

async function installRemote(gatewayUrl: string, force: boolean): Promise<SkillResult[]> {
  const api = skillsApi()
  if (!api?.listNative || !api.buildArchive) return []
  const natives = await api.listNative()
  const results: SkillResult[] = []

  for (const { slug, version } of natives) {
    if (!force && installedVersion(gatewayUrl, slug) === version) {
      results.push({ slug, status: 'up-to-date' })
      continue
    }
    try {
      const archive = await api.buildArchive(slug)
      if (!archive.ok || !archive.base64 || !archive.sha256 || !archive.sizeBytes) {
        throw new Error(archive.error ?? 'failed to build skill archive')
      }
      const { uploadId } = await gatewayClient.request<{ uploadId: string }>('skills.upload.begin', {
        kind: 'skill-archive', slug, sizeBytes: archive.sizeBytes, sha256: archive.sha256, force: true,
      })
      // Files are a few KB — a single chunk covers the whole archive.
      await gatewayClient.request('skills.upload.chunk', { uploadId, offset: 0, dataBase64: archive.base64 })
      await gatewayClient.request('skills.upload.commit', { uploadId, sha256: archive.sha256 })
      await gatewayClient.request('skills.install', {
        source: 'upload', uploadId, slug, sha256: archive.sha256, force: true,
      })
      rememberInstalled(gatewayUrl, slug, version)
      results.push({ slug, status: 'installed' })
    } catch (e) {
      results.push({ slug, status: 'error', error: cleanError(e) })
    }
  }
  return results
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function installNativeSkills(gatewayUrl: string | undefined, force = false): Promise<SkillResult[]> {
  const api = skillsApi()
  if (!api) return []  // not running under Electron

  if (isLocalGateway(gatewayHost(gatewayUrl))) {
    const res = await api.installNative(force)
    return res.results ?? []
  }
  if (!gatewayUrl) return []
  return installRemote(gatewayUrl, force)
}

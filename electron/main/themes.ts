import { app, dialog, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { randomBytes } from 'crypto'
import JSZip from 'jszip'

// Theme package (`.joaxtheme`, a zip) import/export + background-image picking. Themes
// live on disk under userData/themes/<id>/ (theme.json + backgrounds/), so image bytes
// never touch localStorage. Validation/serialization is the renderer's job (one source
// of truth in src/lib/themeFormat.ts) — here we only do dialogs, zip, and file I/O.

const SLOTS = ['app', 'chat'] as const
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp',
}

const themesDir = () => join(app.getPath('userData'), 'themes')
const themeDir = (id: string) => join(themesDir(), safe(id))
const rand = () => randomBytes(4).toString('hex')
const safe = (s: string) => (s || 'theme').replace(/[^a-z0-9._-]/gi, '_').slice(0, 64)
const extOf = (p: string) => { const m = /\.[a-z0-9]+$/i.exec(p); return m ? m[0].toLowerCase() : '.png' }
const parentWin = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined

type Manifest = Record<string, unknown> & {
  id?: string; name?: string
  backgrounds?: Record<string, { file?: string; [k: string]: unknown }>
}

export function registerThemeIpc(): void {
  // Import a .joaxtheme zip → extract backgrounds to disk → return the manifest with a
  // fresh id and absolute background paths for the renderer to validate + save.
  ipcMain.handle('theme:import', async () => {
    try {
      const win = parentWin()
      const opts = { properties: ['openFile' as const], filters: [{ name: 'JoaxClaw Theme', extensions: ['joaxtheme', 'zip'] }] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }

      const zip = await JSZip.loadAsync(await readFile(res.filePaths[0]))
      const jsonEntry = zip.file('theme.json')
      if (!jsonEntry) return { ok: false, error: 'No theme.json in the package' }
      const manifest = JSON.parse(await jsonEntry.async('string')) as Manifest

      const id = `theme-${safe(String(manifest.name ?? manifest.id ?? 'imported'))}-${rand()}`
      const dir = join(themeDir(id), 'backgrounds')

      for (const slot of SLOTS) {
        const bg = manifest.backgrounds?.[slot]
        if (!bg?.file) continue
        const entry = zip.file(bg.file)
        if (!entry) { delete manifest.backgrounds![slot]; continue }
        await mkdir(dir, { recursive: true })
        const abs = join(dir, `${slot}-${rand()}${extOf(bg.file)}`)
        await writeFile(abs, await entry.async('nodebuffer'))
        bg.file = abs
      }

      manifest.id = id
      return { ok: true, theme: manifest }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Export: renderer passes the serialized theme.json manifest (relative bg paths) plus a
  // slot→absolute-path map; we zip theme.json + the referenced images and save.
  ipcMain.handle('theme:export', async (_e, manifest: Manifest, bgFiles: Record<string, string>) => {
    try {
      const win = parentWin()
      const name = safe(String(manifest.name ?? 'theme'))
      const opts = { defaultPath: `${name}.joaxtheme`, filters: [{ name: 'JoaxClaw Theme', extensions: ['joaxtheme'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }

      const zip = new JSZip()
      zip.file('theme.json', JSON.stringify(manifest, null, 2))
      for (const slot of SLOTS) {
        const abs = bgFiles?.[slot]
        const rel = manifest.backgrounds?.[slot]?.file
        if (!abs || !rel) continue
        try { zip.file(rel, await readFile(abs)) } catch { /* skip a missing image */ }
      }
      await writeFile(res.filePath, await zip.generateAsync({ type: 'nodebuffer' }))
      return { ok: true, path: res.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Pick an image for a theme's background slot → copy into the theme's dir → return the
  // new absolute path + a data URL for immediate preview.
  ipcMain.handle('theme:pickImage', async (_e, themeId: string, slot: string) => {
    try {
      const win = parentWin()
      const opts = { properties: ['openFile' as const], filters: [{ name: 'Images', extensions: IMAGE_EXTS }] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }

      const src = res.filePaths[0]
      const dir = join(themeDir(themeId), 'backgrounds')
      await mkdir(dir, { recursive: true })
      const ext = extOf(src)
      const abs = join(dir, `${safe(slot)}-${rand()}${ext}`)
      const bytes = await readFile(src)
      await writeFile(abs, bytes)
      return { ok: true, file: abs, dataUrl: `data:${MIME[ext] ?? 'image/png'};base64,${bytes.toString('base64')}` }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // Remove a theme's on-disk assets (called when a custom theme is deleted).
  ipcMain.handle('theme:deleteAssets', async (_e, themeId: string) => {
    try {
      await rm(themeDir(themeId), { recursive: true, force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}

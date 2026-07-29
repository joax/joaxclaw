#!/usr/bin/env node
// Builds the joaxclaw.ai static site into out/site.
//
//   site/index.html      hand-written landing page (placeholders filled in below)
//   site/*.md            docs pages rendered through site/template.html
//   CHANGELOG.md         rendered as the release history page
//
// Download links are baked in from the GitHub Releases API at build time, and refreshed
// client-side by site/download.js — so a new release shows up without redeploying, and
// the page still works if the API is unreachable at build time (or offline).

import { mkdir, readFile, writeFile, copyFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMarkdown } from './markdown.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'site')
const OUT = join(ROOT, 'out', 'site')
const REPO = process.env.GITHUB_REPOSITORY || 'joax/joaxclaw'
const RELEASES = `https://github.com/${REPO}/releases`

const fmtSize = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`

// Latest release + its macOS/Linux artifacts. Any failure (offline, rate-limited, no
// release yet) falls back to the releases page rather than breaking the build.
async function latestRelease() {
  const fallback = { version: null, mac: null, linux: null }
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'joaxclaw-site-build' }
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers, signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const release = await res.json()
    const pick = ext => release.assets?.find(a => a.name.toLowerCase().endsWith(ext))
    const asMeta = a => a && { url: a.browser_download_url, size: fmtSize(a.size), name: a.name }
    return {
      version: (release.tag_name || '').replace(/^v/, '') || null,
      mac: asMeta(pick('.dmg')),
      linux: asMeta(pick('.deb')),
    }
  } catch (err) {
    console.warn(`  ! release lookup failed (${err.message}) — linking to the releases page`)
    return fallback
  }
}

async function copyDir(from, to) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dest = join(to, entry.name)
    if (entry.isDirectory()) await copyDir(src, dest)
    else await copyFile(src, dest)
  }
}

const fill = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in values ? values[key] : whole))

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(join(OUT, 'assets'), { recursive: true })

  const release = await latestRelease()
  const year = String(new Date().getFullYear())

  // Static files that ship as-is.
  for (const name of ['styles.css', 'download.js', 'CNAME']) {
    if (existsSync(join(SITE, name))) await copyFile(join(SITE, name), join(OUT, name))
  }

  // Artwork. Both logo variants ship: the page follows the visitor's colour scheme, so
  // the pale artwork would wash out on a light background and vice versa. (The app's
  // file names describe the artwork's own tone, hence the flip.)
  await copyFile(join(ROOT, 'src/assets/logo-dark.png'), join(OUT, 'assets/logo-on-dark.png'))
  await copyFile(join(ROOT, 'src/assets/logo.png'), join(OUT, 'assets/logo-on-light.png'))
  await copyFile(join(ROOT, 'resources/icon.png'), join(OUT, 'assets/icon.png'))
  if (existsSync(join(ROOT, 'docs/screenshots'))) {
    await copyDir(join(ROOT, 'docs/screenshots'), join(OUT, 'assets/screenshots'))
  }

  // Landing page.
  const index = await readFile(join(SITE, 'index.html'), 'utf8')
  await writeFile(join(OUT, 'index.html'), fill(index, {
    VERSION: release.version ? `v${release.version}` : 'latest',
    MAC_URL: release.mac?.url ?? `${RELEASES}/latest`,
    MAC_SIZE: release.mac ? `Universal · ${release.mac.size}` : 'Universal',
    LINUX_URL: release.linux?.url ?? `${RELEASES}/latest`,
    LINUX_SIZE: release.linux ? `x86-64 · ${release.linux.size}` : 'x86-64',
    RELEASES,
    YEAR: year,
  }))

  // Markdown pages: site/*.md plus the root changelog.
  const template = await readFile(join(SITE, 'template.html'), 'utf8')
  const pages = [
    ...(await readdir(SITE)).filter(f => f.endsWith('.md')).map(f => ({
      source: join(SITE, f),
      out: `${basename(f, '.md')}.html`,
      title: basename(f, '.md').replace(/(^|-)(\w)/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase()),
    })),
    { source: join(ROOT, 'CHANGELOG.md'), out: 'changelog.html', title: 'Changelog' },
  ]
  for (const page of pages) {
    const md = await readFile(page.source, 'utf8')
    await writeFile(join(OUT, page.out), fill(template, {
      TITLE: page.title,
      CONTENT: renderMarkdown(md),
      YEAR: year,
    }))
    console.log(`  → ${page.out}`)
  }

  const bytes = (await stat(join(OUT, 'index.html'))).size
  console.log(`\n✓ site built → out/site (index.html ${(bytes / 1024).toFixed(1)} KB, ${release.version ? `v${release.version}` : 'no release found'})`)
}

main().catch(err => { console.error(err); process.exit(1) })

#!/usr/bin/env node
// Builds the joaxclaw.ai static site into out/site.
//
//   site/index.html      hand-written landing page (placeholders filled in below)
//   site/*.md            docs pages rendered through site/template.html
//   CHANGELOG.md         rendered as the release history page
//
// Download links are NOT baked in. They are the fixed paths /download/mac and
// /download/linux, which api/download.mjs resolves to the newest release per request —
// so a release is downloadable the moment it publishes, with no redeploy, and a build
// that cannot reach GitHub still produces a working page. Only the cosmetic parts (the
// version label and each file's size) are looked up here, and site/download.js fills
// them in from /api/release if this build had no token.

import { mkdir, readFile, writeFile, copyFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMarkdown } from './markdown.mjs'
import { describeRelease, latestRelease, releasesToken } from '../api/_lib/releases.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'site')
const OUT = join(ROOT, 'out', 'site')
// The repo is private, so github.com/<repo>/releases is a 404 for visitors. The site's
// own changelog is the public release history now.
const RELEASES = '/changelog.html'

const fmtSize = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`

// The version label and file sizes, when this build can read them. Needs a token now
// that the repo is private; Vercel builds have none, and that is fine — the page is
// complete without them and site/download.js fills them in on load. Any failure is a
// note, never a build break.
async function releaseLabels() {
  const blank = { version: null, mac: null, linux: null }
  if (!releasesToken()) {
    console.log('  · no RELEASES_TOKEN — version and sizes will be filled in by the browser')
    return blank
  }
  try {
    const { version, assets } = describeRelease(await latestRelease())
    return { version, mac: assets.mac, linux: assets.linux }
  } catch (err) {
    console.warn(`  ! release lookup failed (${err.message}) — version and sizes left to the browser`)
    return blank
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

  const release = await releaseLabels()
  const year = String(new Date().getFullYear())

  // Static files that ship as-is: every stylesheet and script in site/. Listing them by
  // hand meant a new page's script silently didn't ship.
  for (const name of (await readdir(SITE)).filter(f => /\.(css|js)$/.test(f))) {
    await copyFile(join(SITE, name), join(OUT, name))
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

  // Hand-written pages (landing, account) — placeholders filled in.
  const values = {
    VERSION: release.version ? `v${release.version}` : 'latest',
    // Fixed paths, resolved per request by api/download.mjs — never a release-specific url.
    MAC_URL: '/download/mac',
    MAC_SIZE: release.mac ? `Universal · ${fmtSize(release.mac.size)}` : 'Universal',
    LINUX_URL: '/download/linux',
    LINUX_SIZE: release.linux ? `x86-64 · ${fmtSize(release.linux.size)}` : 'x86-64',
    RELEASES,
    YEAR: year,
  }
  for (const name of (await readdir(SITE)).filter(f => f.endsWith('.html') && f !== 'template.html')) {
    await writeFile(join(OUT, name), fill(await readFile(join(SITE, name), 'utf8'), values))
    console.log(`  → ${name}`)
  }

  // The hosted web app, if it has been built (npm run build:web → out/web). Served under
  // /app/ and gated by middleware.js; absent locally, the site still builds fine and the
  // account page just has nothing to link to.
  const web = join(ROOT, 'out', 'web')
  if (existsSync(web)) {
    await copyDir(web, join(OUT, 'app'))
    console.log('  → app/ (hosted web app)')
  } else {
    console.log('  ! out/web missing — skipping /app (run npm run build:web first)')
  }

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
  console.log(`\n✓ site built → out/site (index.html ${(bytes / 1024).toFixed(1)} KB, ${release.version ? `v${release.version}` : 'version resolved at runtime'})`)
}

main().catch(err => { console.error(err); process.exit(1) })

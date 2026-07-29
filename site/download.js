// Keeps the download buttons pointing at the newest release without a site redeploy.
// The build bakes in whatever was current at build time; this refreshes it on load and
// silently leaves the baked links alone if the API is unreachable or rate-limited.

const REPO = 'joax/joaxclaw'

const fmtSize = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const LABELS = {
  mac: (asset) => `Universal · ${fmtSize(asset.size)}`,
  linux: (asset) => `x86-64 · ${fmtSize(asset.size)}`,
}

const MATCH = {
  mac: name => name.toLowerCase().endsWith('.dmg'),
  linux: name => name.toLowerCase().endsWith('.deb'),
}

async function refresh() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
  })
  if (!res.ok) return
  const release = await res.json()

  for (const el of document.querySelectorAll('[data-download]')) {
    const platform = el.dataset.download
    const asset = release.assets?.find(a => MATCH[platform]?.(a.name))
    if (!asset) continue
    el.href = asset.browser_download_url
    const meta = el.querySelector('.meta')
    if (meta) meta.textContent = LABELS[platform](asset)
  }

  const version = (release.tag_name || '').replace(/^v/, '')
  if (version) {
    for (const el of document.querySelectorAll('[data-version]')) el.textContent = `v${version}`
  }
}

refresh().catch(() => { /* keep the build-time links */ })

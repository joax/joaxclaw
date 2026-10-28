// Fills in the version and each installer's size on load.
//
// The buttons' hrefs are already correct before this runs — they point at /download/mac
// and /download/linux, which resolve to the newest release server-side, so a release
// never needs a redeploy to be downloadable. All this adds is the label: "v0.27.2",
// "Universal · 236.4 MB". If the lookup fails the buttons still work.
//
// (It used to read api.github.com directly. That stopped working when the repo went
// private — the releases API 404s for a logged-out visitor — so the lookup moved behind
// /api/release, where the token lives.)

const fmtSize = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const LABELS = {
  mac: asset => `Universal · ${fmtSize(asset.size)}`,
  linux: asset => `x86-64 · ${fmtSize(asset.size)}`,
}

async function refresh() {
  const res = await fetch('/api/release', { headers: { accept: 'application/json' } })
  if (!res.ok) return
  const release = await res.json()

  for (const el of document.querySelectorAll('[data-download]')) {
    const asset = release.assets?.[el.dataset.download]
    if (!asset) continue
    if (asset.url) el.href = asset.url
    const meta = el.querySelector('.meta')
    if (meta) meta.textContent = LABELS[el.dataset.download](asset)
  }

  if (release.version) {
    for (const el of document.querySelectorAll('[data-version]')) el.textContent = `v${release.version}`
  }
}

refresh().catch(() => { /* the baked-in links already work */ })

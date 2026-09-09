import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The changelog is read by the release workflow, not just by people.
//
// `.gitattributes` sets `CHANGELOG.md merge=union` so two open PRs stop conflicting on
// the one line every entry is added to. Union keeps both sides of a hunk without
// understanding structure, though, so when two branches each CREATE the "## [Unreleased]"
// header — rather than adding to an existing one — it keeps both.
//
// That has now happened twice. The first time was caught by hand while cutting 0.24.1,
// which would otherwise have shipped a release missing half its entries: the workflow
// extracts with
//
//   awk '$0 ~ "^## \\[" v "\\]" { found=1; next } found && /^## \[/ { exit } found { print }'
//
// which stops at the next "## [" heading, so only the FIRST section is ever published.
// A note asking people to check was not enough, so this checks instead — at commit time,
// via the pre-commit hook, rather than at release time when it is least welcome.

const changelog = () => readFileSync('CHANGELOG.md', 'utf8')

describe('CHANGELOG.md structure', () => {
  it('has at most one Unreleased section', () => {
    const count = [...changelog().matchAll(/^## \[Unreleased\]$/gm)].length
    expect(count, 'a union merge kept two — fold them into one before releasing').toBeLessThanOrEqual(1)
  })

  it('has no duplicate version headings', () => {
    // The workflow publishes the first match, so a second one is invisible.
    const versions = [...changelog().matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m => m[1])
    expect(versions).toEqual([...new Set(versions)])
  })

  it('leaves every released section extractable by the workflow', () => {
    // Mirrors the awk above: a section that yields nothing would publish as a bare
    // "Release vX" note, silently losing whatever was written for it. Only that it has
    // content is checked — early sections predate the current "- **Bold.**" style, and a
    // guard against an empty release has no business enforcing prose retroactively.
    const text = changelog()
    for (const m of text.matchAll(/^## \[(\d+\.\d+\.\d+)\][^\n]*$/gm)) {
      const rest = text.slice(m.index! + m[0].length)
      const end = rest.search(/^## \[/m)
      const body = (end === -1 ? rest : rest.slice(0, end))
      expect(body, `section ${m[1]} is empty`).toMatch(/^- \S/m)
    }
  })
})

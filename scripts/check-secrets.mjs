#!/usr/bin/env node
// Secret scanner — blocks commits that would publish keys / tokens / credentials.
//
// Runs in the pre-commit hook (before lint/type-check/test) over the STAGED
// content of added/modified files. Pass `--all` to scan every tracked file
// (useful for an audit). Dependency-free on purpose, matching this repo's style.
//
// Found a FALSE POSITIVE? Either:
//   • add an inline `secrets:allow` comment on that line, or
//   • add the file (a glob) to ALLOW_FILES below.
// Found a REAL secret? Remove it, rotate it, and keep it in env / gateway config
// (which lives outside the repo), not in source.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ALL = process.argv.includes('--all')

// Files never scanned (lockfiles, maps, the scanner itself, binaries handled separately).
const ALLOW_FILES = [
  /(^|\/)package-lock\.json$/, /(^|\/)npm-shrinkwrap\.json$/,
  /(^|\/)pnpm-lock\.yaml$/, /(^|\/)yarn\.lock$/, /\.lock$/,
  /(^|\/)scripts\/check-secrets\.mjs$/,
  /\.min\.js$/, /\.map$/,
]
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|mov|wav|mp3|deb|dmg|exe|node|wasm)$/i
const MAX_BYTES = 1_000_000

// Lines carrying this marker are skipped (escape-hatch for genuine false positives).
const ALLOW_PRAGMA = /secrets:allow|gitleaks:allow|secretlint-disable/i

// Values that are obviously placeholders, env-var NAMES, or interpolations — not secrets.
function isPlaceholder(v) {
  if (!v || v.length < 16) return true
  if (/[…<>]|\.\.\.|\$\{|process\.env|import\.meta/.test(v)) return true
  if (/^(x{3,}|0{8,}|change[_-]?me|your[_-]|example|placeholder|dummy|sample|fake|redacted|test[_-]|none|null|undefined)/i.test(v)) return true
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(v)) return true          // ENV_VAR_NAME, not a value
  if (/^[0-9]+$/.test(v)) return true                       // pure numbers
  if (/^(.)\1{7,}$/.test(v)) return true                    // aaaaaaaa…
  return false
}

// Rules. `value` rules capture group 1 and run the placeholder filter; `match`
// rules flag the raw hit (these formats are already specific enough).
const RULES = [
  { name: 'private-key',        kind: 'match', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'aws-access-key',     kind: 'match', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'openai-key',         kind: 'match', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/ },
  { name: 'google-api-key',     kind: 'match', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'github-token',       kind: 'match', re: /\b(?:gh[posru]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: 'slack-token',        kind: 'match', re: /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/ },
  { name: 'slack-app-token',    kind: 'match', re: /\bxapp-[0-9]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'slack-webhook',      kind: 'match', re: /hooks\.slack\.com\/services\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+/ },
  { name: 'gitlab-token',       kind: 'match', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'stripe-key',         kind: 'match', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'sendgrid-key',       kind: 'match', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { name: 'npm-token',          kind: 'match', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'jwt',                kind: 'match', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/ },
  { name: 'url-credentials',    kind: 'match', re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
  // Generic "<secret-ish key> = '<value>'" — filtered through isPlaceholder().
  { name: 'hex-token',          kind: 'value', re: /(?:token|secret|auth|api[_-]?key|access[_-]?key|password)["']?\s*[:=]\s*["']([0-9a-f]{32,})["']/i },
  { name: 'secret-assignment',  kind: 'value', re: /(?:secret|token|passwd|password|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|bearer)["']?\s*[:=]\s*["']([A-Za-z0-9_\-/+=.]{16,})["']/i },
]

function redact(s) {
  if (s.length <= 10) return s[0] + '***'
  return `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`
}

function stagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString('utf8')
  return out.split('\0').filter(Boolean)
}
function allFiles() {
  return execFileSync('git', ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
}
function readContent(file) {
  // Staged mode reads the staged blob (what's actually being committed), which may
  // differ from the working tree. --all reads the working tree from disk.
  try {
    return ALL
      ? readFileSync(file, 'utf8')
      : execFileSync('git', ['show', `:${file}`]).toString('utf8')
  } catch {
    return null
  }
}

const files = (ALL ? allFiles() : stagedFiles())
  .filter(f => !ALLOW_FILES.some(re => re.test(f)) && !BINARY_EXT.test(f))

const findings = []
for (const file of files) {
  const content = readContent(file)
  if (content == null || content.length > MAX_BYTES || content.includes('\0')) continue
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (ALLOW_PRAGMA.test(line)) continue
    for (const rule of RULES) {
      const m = rule.re.exec(line)
      if (!m) continue
      const hit = rule.kind === 'value' ? m[1] : m[0]
      if (rule.kind === 'value' && isPlaceholder(hit)) continue
      findings.push({ file, line: i + 1, rule: rule.name, hit })
    }
  }
}

if (findings.length === 0) {
  console.log(`🔒 check-secrets: no secrets found (${files.length} ${ALL ? 'tracked' : 'staged'} file(s) scanned).`)
  process.exit(0)
}

console.error('\n✖ check-secrets: potential secret(s) detected — commit blocked:\n')
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${redact(f.hit)}`)
}
console.error(`
Remove/rotate the secret and keep it out of source (use env vars or gateway config).
If this is a genuine false positive, add a "secrets:allow" comment on that line, or
allowlist the file in scripts/check-secrets.mjs. To bypass once (not recommended):
SKIP_SIMPLE_GIT_HOOKS=1 git commit ...
`)
process.exit(1)

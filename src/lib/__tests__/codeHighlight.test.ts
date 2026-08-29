import { describe, it, expect } from 'vitest'
import { highlightLine } from '../diffHighlight'
import { langFromPath } from '../diffModel'

// End-to-end over the tokenizer: a path in, coloured tokens out. This is what the file
// viewer does per line, so it catches an ALIAS entry pointing at a grammar refractor's
// bundle doesn't actually register (which would silently degrade to plain text).
const cases: [string, string, string][] = [
  ['main.py',        'def greet(name):  # hi',            'python'],
  ['store.ts',       'const x: number = 42',              'typescript'],
  ['app.jsx',        'export default function App() {}',  'javascript'],
  ['package.json',   '{ "name": "joaxclaw" }',            'json'],
  ['conf.yaml',      'key: value  # comment',             'yaml'],
  ['pyproject.toml', '[tool.ruff]',                       'toml'],
  ['main.go',        'func main() { return }',            'go'],
  ['lib.rs',         'fn main() -> u32 { 0 }',            'rust'],
  ['q.sql',          'SELECT * FROM users',               'sql'],
  ['run.sh',         'echo "hello" # note',               'bash'],
  ['Dockerfile',     'FROM node:20',                      'docker'],
]

describe('file-viewer highlighting', () => {
  for (const [path, line, expectedLang] of cases) {
    it(`tokenizes ${path} as ${expectedLang}`, () => {
      const lang = langFromPath(path)
      expect(lang).toBe(expectedLang)
      const toks = highlightLine(line, lang)
      expect(toks, `${path} produced no tokens`).not.toBeNull()
      // More than one token means the grammar actually split the line rather than
      // handing back the whole string untouched.
      expect(toks!.length).toBeGreaterThan(1)
      expect(toks!.map(t => t.value).join('')).toBe(line)
      expect(toks!.some(t => t.className)).toBe(true)
    })
  }

  it('falls back to plain text for a language with no grammar', () => {
    expect(highlightLine('just words', undefined)).toBeNull()
    expect(highlightLine('just words', 'no-such-language')).toBeNull()
  })
})

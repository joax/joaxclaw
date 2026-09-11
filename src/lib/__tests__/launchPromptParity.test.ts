import { describe, it, expect } from 'vitest'
import { buildLaunchPrompt, compileProcessToJob } from '../processCompiler'
// The gateway-side port. It must produce byte-identical prompts to the TypeScript above:
// a headless run and an in-app run of the same team have to behave the same way, and a
// silent divergence here is exactly the kind nobody would think to look for.
// Plain ESM, no types — the same module the plugin loads at runtime.
import {
  buildLaunchPrompt as jsBuild, compileProcessToJob as jsCompile, parseCompiledProcess,
  buildLaunchRunRecord, canReplaceRunRecord,
} from '../../../plugins/joaxclaw-fs/launchPrompt.js'
import type { ProcessDef } from '../processParser'

const linear: ProcessDef = {
  id: 'inbox-triage',
  name: 'Inbox Triage Team',
  graph: {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 } },
      { id: 'agent-0', type: 'agent', position: { x: 1, y: 0 }, agentId: 'main', role: 'Triager', task: 'Sort {objective}.' },
      { id: 'end', type: 'end', position: { x: 2, y: 0 } },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'agent-0' },
      { id: 'e2', from: 'agent-0', to: 'end' },
    ],
  },
} as ProcessDef

const withWorkspaceAndContract: ProcessDef = {
  ...linear,
  id: 'feature-dev',
  name: 'Feature Development Team',
  workspace: '/home/joaxap/repos/thing',
  outputContract: 'A merged PR for {objective}.',
} as ProcessDef

describe('launch prompt parity — plugin port vs the app', () => {
  it('matches for a plain linear team', () => {
    const job = compileProcessToJob(linear)
    expect(jsBuild(linear, jsCompile(linear))).toBe(buildLaunchPrompt(linear, job))
  })

  it('matches with a run objective, including {objective} substitution', () => {
    const task = 'Clear everything older than a week'
    expect(jsBuild(linear, jsCompile(linear), task))
      .toBe(buildLaunchPrompt(linear, compileProcessToJob(linear), task))
  })

  it('matches with a shared workspace and an output contract', () => {
    // The workspace branch rewrites three separate blocks of the prompt, and the
    // contract is substituted too — the most divergence-prone path.
    const task = 'Add rate limiting'
    expect(jsBuild(withWorkspaceAndContract, jsCompile(withWorkspaceAndContract), task))
      .toBe(buildLaunchPrompt(withWorkspaceAndContract, compileProcessToJob(withWorkspaceAndContract), task))
  })

  it('compiles the job with identical key order', () => {
    // The job is JSON.stringify'd INTO the prompt, so key order is part of the output.
    expect(JSON.stringify(jsCompile(withWorkspaceAndContract)))
      .toBe(JSON.stringify(compileProcessToJob(withWorkspaceAndContract)))
  })

  it('omits workspace from the job when the team has none', () => {
    expect('workspace' in (jsCompile(linear) as object)).toBe(false)
  })
})

describe('parseCompiledProcess', () => {
  const file = [
    '---',
    'id: calla-ventures-research',
    'name: Calla Ventures Research',
    'controller: research-worker',
    'outputContract: "One candidate added to INVENTORY.md."',
    '---',
    '',
    '<!-- graph-data',
    '{"nodes":[{"id":"start","type":"start"},{"id":"agent-0","type":"agent","agentId":"research-worker"}],"edges":[{"id":"e1","from":"start","to":"agent-0"}]}',
    '-->',
    '',
    '# Calla Ventures Research',
  ].join('\n')

  it('reads the fields the prompt needs', () => {
    const def = parseCompiledProcess(file, 'fallback')
    expect(def.id).toBe('calla-ventures-research')
    expect(def.name).toBe('Calla Ventures Research')
    expect(def.controllerAgentId).toBe('research-worker')
    expect(def.outputContract).toBe('One candidate added to INVENTORY.md.')
    expect(def.graph.nodes).toHaveLength(2)
  })

  it('refuses a file with no graph, because the graph is the team', () => {
    expect(parseCompiledProcess('---\nid: x\n---\n\n# Nothing here', 'x')).toBeNull()
  })

  it('refuses unparsable graph data rather than launching a broken team', () => {
    expect(parseCompiledProcess('---\nid: x\n---\n<!-- graph-data\n{not json\n-->', 'x')).toBeNull()
  })

  it('refuses a file with no frontmatter', () => {
    expect(parseCompiledProcess('# Just a heading', 'x')).toBeNull()
  })

  it('omits absent optional fields rather than setting them undefined', () => {
    const def = parseCompiledProcess(
      '---\nid: x\nname: X\n---\n<!-- graph-data\n{"nodes":[],"edges":[]}\n-->', 'x',
    )
    expect('workspace' in def).toBe(false)
    expect('outputContract' in def).toBe(false)
  })
})

describe('the run record a headless launch leaves behind', () => {
  it('records an attempt, not a run', () => {
    // Status matters: the sequence view reads `status` and `stepsDone` literally, so
    // claiming 'running' or a completed step would show work the gateway never did.
    const rec = buildLaunchRunRecord('inbox-triage', undefined, 1_700_000_000_000)
    expect(rec.status).toBe('idle')
    expect(rec.stepsDone).toBe(0)
    expect(rec.startedAt).toBe(1_700_000_000_000)
    expect(rec.log).toHaveLength(1)
  })

  it('keeps the objective so the rail says what was asked for', () => {
    expect(buildLaunchRunRecord('x', 'Clear the backlog').objective).toBe('Clear the backlog')
    expect('objective' in buildLaunchRunRecord('x', undefined)).toBe(false)
  })

  it('is a ProcessRun the app can read straight back', async () => {
    // The plugin writes this file and the app parses it into a ProcessRun. The compiler
    // cannot check that — the plugin module is plain JS, so its return type is `any` and
    // a cast would assert nothing. So read the interface itself: a field renamed on
    // either side shows up here instead of as a run record the rail cannot render.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/store/processes.ts', 'utf8')
    const body = src.slice(src.indexOf('export interface ProcessRun'))
    const fields = [...body.slice(0, body.indexOf('\n}')).matchAll(/^  (\w+)(\??):/gm)]
    expect(fields.length).toBeGreaterThan(5)

    const optional = new Set(fields.filter(f => f[2] === '?').map(f => f[1]))
    const known = new Set(fields.map(f => f[1]))
    const rec = buildLaunchRunRecord('x', 'go')

    // Every key written must be a field ProcessRun declares…
    expect(Object.keys(rec).filter(k => !known.has(k))).toEqual([])
    // …and every required field must be written, or the app reads back undefined.
    expect([...known].filter(k => !optional.has(k) && !(k in rec))).toEqual([])
  })

  it('never overwrites a run that is still going', () => {
    // A second agent asking for the prompt mid-run must not wipe the live run's record.
    expect(canReplaceRunRecord(JSON.stringify({ status: 'running' }))).toBe(false)
  })

  it('replaces a finished, failed or earlier attempt', () => {
    for (const status of ['done', 'error', 'idle']) {
      expect(canReplaceRunRecord(JSON.stringify({ status }))).toBe(true)
    }
  })

  it('replaces a record it cannot read, rather than refusing forever', () => {
    // A half-written or older-format file would otherwise block every future launch
    // record for that team — worse than losing a record nothing can parse.
    expect(canReplaceRunRecord('{not json')).toBe(true)
    expect(canReplaceRunRecord(null)).toBe(true)
    expect(canReplaceRunRecord('')).toBe(true)
  })
})

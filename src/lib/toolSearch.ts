// Whether the gateway is putting local models on Tool Search: the usual reason they
// write tool calls as text instead of making them.
//
// With Tool Search on, a model gets real schemas only for `tool_search`, `tool_describe`
// and `tool_call`, plus the core coding tools. Every other tool (`ls` included) appears
// only as a list of names in the prompt. Cloud models work through the search tools;
// local ones such as Qwen copy the list and write `<ls><path>…` into the reply, and
// nothing runs.
//
// When it applies:
//  - `tools.toolSearch: false`: never. An explicit value always wins.
//  - `tools.toolSearch` true or an object: yes.
//  - Unset on 2026.9 and later: yes for local routes, automatically
//    (`resolveToolSearchMode` in the gateway's Ollama policy).
//  - Unset on 2026.8: only through lean mode (`agents.defaults.experimental.localModelLean`),
//    which onboarding turns on for a local model.
// The exact 2026.9 patch release that made it automatic isn't pinned down. Treating all
// of 2026.9 as automatic can at worst suggest switching off something already off,
// which is harmless.

/** `tools.toolSearch` explicitly switched off: `false`, or an object with `enabled: false`. */
export function isExplicitlyOff(setting: unknown): boolean {
  return setting === false
    || (!!setting && typeof setting === 'object' && (setting as { enabled?: unknown }).enabled === false)
}

/** "2026.9.4", "2026.9.4-beta.1" or "OpenClaw 2026.9.4 (3a9d69d)" → [2026, 9, 4]. */
export function parseCalVer(version: string | undefined): [number, number, number] | null {
  const m = version ? /(\d{4})\.(\d{1,2})\.(\d{1,3})/.exec(version) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function localToolSearchOn(p: { setting: unknown; localModelLean?: unknown; serverVersion?: string }): boolean {
  if (isExplicitlyOff(p.setting)) return false
  if (p.setting !== undefined && p.setting !== null) return true
  if (p.localModelLean === true) return true
  const v = parseCalVer(p.serverVersion)
  return !!v && (v[0] > 2026 || (v[0] === 2026 && v[1] >= 9))
}

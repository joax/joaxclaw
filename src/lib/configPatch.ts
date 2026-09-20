// Turning an edited config into something `config.patch` actually applies.
//
// `config.patch` is an RFC-7396 merge patch: a key that is absent is LEFT ALONE, and a
// key set to null is removed. Sending the edited document as the patch therefore applies
// every addition and change, and silently ignores every removal — the gateway answers
// `{ok:true, noop:true, changedPaths:[]}` for a pure deletion, and the app used to report
// that as "Saved". `buildMergePatch` diffs the edited document against the one that was
// loaded, so removals become explicit nulls at any depth.
//
// Arrays have a second rule: the gateway merges object arrays BY ID and refuses to shrink
// one unless its exact dotted path is named in `replacePaths` (a parent path is not
// enough, and only ARRAY paths count — naming an object path does nothing). So any array
// that differs is sent whole, with its path listed.

/** The gateway's reply to config.patch, as far as we read it. */
export interface ConfigPatchResult {
  ok?: boolean
  noop?: boolean
  changedPaths?: string[]
  hash?: string
  path?: string
}

/**
 * True when the gateway accepted the write but changed nothing: either it said so, or it
 * reported no changed paths. A save that lands here must not be reported as saved.
 */
export function patchChangedNothing(res: ConfigPatchResult | undefined | null): boolean {
  if (!res) return false
  if (res.noop === true) return true
  return Array.isArray(res.changedPaths) && res.changedPaths.length === 0
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

/** Every array path inside a value, in the gateway's dotted notation (`a.b[].c`). */
export function collectArrayPaths(obj: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(obj)) {
    out.push(prefix)
    for (const item of obj) collectArrayPaths(item, `${prefix}[]`, out)
  } else if (isPlainObject(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      collectArrayPaths(v, prefix ? `${prefix}.${k}` : k, out)
    }
  }
}

export interface MergePatch {
  /** The patch to send as `raw`, or null when nothing changed. */
  patch: Record<string, unknown> | null
  /** Array paths in the patch, for `replacePaths`. */
  replacePaths: string[]
}

/**
 * The RFC-7396 merge patch that turns `before` into `after`: changed values, `null` for
 * removed keys at any depth, and arrays taken whole. `patch` is null when the two are
 * already identical, so the caller can say "nothing to save" instead of asking the
 * gateway and getting a no-op back.
 */
export function buildMergePatch(before: unknown, after: unknown): MergePatch {
  const patch = diff(before, after)
  if (patch === undefined) return { patch: null, replacePaths: [] }
  const obj = isPlainObject(patch) ? patch : {}
  const paths: string[] = []
  collectArrayPaths(obj, '', paths)
  return { patch: obj, replacePaths: [...new Set(paths)].filter(p => p !== '') }
}

/** The patch for one value, or `undefined` when it is unchanged. */
function diff(before: unknown, after: unknown): unknown {
  if (deepEqual(before, after)) return undefined
  // An array or a scalar replaces what was there; only objects merge key by key.
  if (!isPlainObject(before) || !isPlainObject(after)) return after
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(after)) {
    const d = diff(before[k], v)
    if (d !== undefined) out[k] = d
  }
  // A key the edit removed: null tells the gateway to delete it.
  for (const k of Object.keys(before)) if (!(k in after)) out[k] = null
  return Object.keys(out).length ? out : undefined
}

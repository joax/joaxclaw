// The one mapping from a state to a colour. Design rule: accent = working, warning = needs
// you, danger = failed, success = done. Every pill, strip, dot and tray label uses it, so
// the same state looks the same everywhere. Features map their own states onto these five
// in their own lib (lib/tasks.ts, lib/goals.ts, …) and never pick colours directly.

export type StateTone = 'working' | 'needsYou' | 'failed' | 'done' | 'idle'

const TOKEN: Record<StateTone, string> = {
  working: 'var(--accent)',
  needsYou: 'var(--warning)',
  failed: 'var(--danger)',
  done: 'var(--success)',
  idle: 'var(--text-secondary)',
}

/** The colour for a state. Anything unrecognised reads as idle. */
export function toneColor(tone: StateTone | string): string {
  return TOKEN[tone as StateTone] ?? TOKEN.idle
}

/** A tinted background for a state: `color-mix(in srgb, <colour> <pct>%, <over>)`. */
export function toneTint(tone: StateTone | string, pct = 13, over = 'transparent'): string {
  return `color-mix(in srgb, ${toneColor(tone)} ${pct}%, ${over})`
}

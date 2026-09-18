import type { NavSection } from '../../App'
import { useGatewaySupport } from '../../lib/useGatewaySupport'

/**
 * Nav sections this gateway can't back, so the rail and the phone's More sheet leave them
 * out. Meetings needs the transcript library (`transcripts.list`, OpenClaw 2026.8+).
 */
export function useHiddenNavSections(): ReadonlySet<NavSection> {
  const meetings = useGatewaySupport({ methods: ['transcripts.list'] }).supported
  return meetings ? NONE : NO_MEETINGS
}

const NONE: ReadonlySet<NavSection> = new Set()
const NO_MEETINGS: ReadonlySet<NavSection> = new Set<NavSection>(['meetings'])

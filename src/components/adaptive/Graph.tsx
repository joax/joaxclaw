import { ForceGraph } from '../obsidian/ForceGraph'
import type { MemoryGraph } from '../../lib/memory/types'
import { usePlatform } from '../../lib/platform'

// Adaptive graph — the single swap point for the memory backlink graph.
//
// Desktop renders the canvas force-graph, which is driven by mouse drag/wheel and
// runs a continuous physics loop. The mobile arm is a TODO: on touch it needs
// pointer/pinch handling and a lighter (or deferred) render (see the mobile-port
// roadmap). Centralizing it here keeps that swap in one place.
export interface GraphProps {
  data: MemoryGraph
  width: number
  height: number
}

export function Graph({ data, width, height }: GraphProps) {
  const { isMobile } = usePlatform()

  // TODO(mobile): touch-enabled / simplified arm when `isMobile`. Desktop unchanged.
  void isMobile

  return <ForceGraph data={data} width={width} height={height} />
}

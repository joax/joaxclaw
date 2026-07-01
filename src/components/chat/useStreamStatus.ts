import { useEffect, useRef, useState } from 'react'
import { useConnectionStore } from '../../store/connection'
import { useSettingsStore } from '../../store/settings'
import { useOllamaProgress } from '../../store/ollamaProgress'
import type { ChatMessage } from '../../lib/types'
import { computeStreamStatus, activityKey, hasProduced, isActivelyWorking, type StreamStatus } from '../../lib/streamStatus'

export type { StreamStatus }

// React glue over computeStreamStatus: tracks per-turn timestamps and re-evaluates on a
// 1s tick (status changes with elapsed time even without new renders). All the decision
// logic lives in ../../lib/streamStatus (pure + unit-tested).
export function useStreamStatus(streamingMsg: ChatMessage | undefined, isStreaming: boolean): {
  status: StreamStatus
  elapsedSeconds: number
} {
  const connected = useConnectionStore(s => s.status === 'connected')
  const lastHeartbeat = useConnectionStore(s => s.lastHeartbeat)
  const stallMs = useSettingsStore(s => s.streamStallTimeout * 1000)
  // Ollama prompt-token ingestion: the model is alive and encoding the prompt before it
  // emits a token. Folding it into the fingerprint keeps the timer from firing during it.
  const promptProgress = useOllamaProgress(s => s.progress)

  const activelyWorking = isActivelyWorking(streamingMsg)
  const key = `${activityKey(streamingMsg)}:${promptProgress ?? ''}:${activelyWorking ? 1 : 0}`
  const produced = hasProduced(streamingMsg)
  const turnId = isStreaming ? (streamingMsg?.id ?? null) : null

  const lastActivityRef = useRef(0)
  const sawActivityRef = useRef(false)

  const [result, setResult] = useState<{ status: StreamStatus; elapsedSeconds: number }>({ status: 'idle', elapsedSeconds: 0 })

  // New turn → reset the clocks.
  useEffect(() => {
    lastActivityRef.current = Date.now()
    sawActivityRef.current = produced
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId])

  // Fingerprint changed → progress; reset the inter-activity clock.
  useEffect(() => {
    lastActivityRef.current = Date.now()
    if (produced) sawActivityRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!isStreaming) { setResult({ status: 'idle', elapsedSeconds: 0 }); return }
    const evaluate = () => setResult(computeStreamStatus({
      isStreaming, connected, lastHeartbeat, now: Date.now(),
      lastActivity: lastActivityRef.current, sawActivity: sawActivityRef.current,
      activelyWorking, stallMs,
    }))
    evaluate()
    const iv = setInterval(evaluate, 1000)
    return () => clearInterval(iv)
  }, [isStreaming, key, connected, lastHeartbeat, stallMs, activelyWorking])

  return result
}

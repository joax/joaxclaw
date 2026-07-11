import { gatewayClient } from './gateway'

// Live progress for a background script the model launched via the joaxclaw-fs
// `script_start` tool. The job runs on the gateway host (surviving app reconnects);
// the chat's ScriptJobCard polls jobs.get to render it. See plugins/joaxclaw-fs.

export interface ScriptJob {
  id: string
  command: string
  cwd?: string
  running: boolean
  done: boolean
  exitCode: number | null
  error?: string | null
  percent?: number | null
  startedAt: number
  finishedAt: number | null
  elapsedMs: number
  output?: string
  outputTruncated?: boolean
}

// script_start's tool result embeds "jobId: <uuid>" — parse it so the chat can attach a
// live card to that tool call. Pure + tested.
const JOB_ID_RE = /jobId:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function parseJobId(result?: string): string | null {
  if (!result) return null
  const m = JOB_ID_RE.exec(result)
  return m ? m[1] : null
}

export function jobStatus(jobId: string): Promise<ScriptJob> {
  return gatewayClient.request<ScriptJob>('jobs.get', { jobId })
}

export function stopJob(jobId: string): Promise<{ ok: boolean }> {
  return gatewayClient.request<{ ok: boolean }>('jobs.stop', { jobId })
}

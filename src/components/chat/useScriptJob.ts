import { useEffect, useState } from 'react'
import { subscribeJob, type JobState } from '../../lib/scriptJobs'

// Live state of one background script job. Backed by the shared watcher in
// scriptJobs.ts, so the inline card and the sticky dock following the same job
// share a single poll loop.
export function useScriptJob(jobId: string): JobState {
  const [state, setState] = useState<JobState>({ job: null, expired: false })
  useEffect(() => subscribeJob(jobId, setState), [jobId])
  return state
}

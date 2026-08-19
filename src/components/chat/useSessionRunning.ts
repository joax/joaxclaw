import { useSessionsStore } from '../../store/sessions'
import { isSessionRunning } from '../../lib/sessionRunning'

/** Live "the gateway is still working on this session" flag — the same signal the
 *  chat list's dot uses, so the transcript can't look finished while the row is lit. */
export function useSessionRunning(sessionKey?: string): boolean {
  return useSessionsStore(s =>
    sessionKey ? isSessionRunning(s.sessions.find(sess => sess.key === sessionKey)) : false,
  )
}

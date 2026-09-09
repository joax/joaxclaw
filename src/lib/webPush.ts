// Tier 2 notifications: true background push, delivered by the gateway.
//
// Tier 1 (lib/notifications.ts) can only fire while the app is still in memory. This
// tier survives the app being killed, because the push comes from the gateway to the
// browser's push service and wakes the service worker.
//
// The gateway side landed in OpenClaw 2026.9: it stores browser subscriptions and its
// own VAPID signing key in `state/openclaw.sqlite` (there is no config key to edit) and
// exposes six methods. The whole surface:
//
//   push.web.vapidPublicKey  {}                        -> { vapidPublicKey }
//   push.web.subscribe       { endpoint, keys }        -- registers this browser
//   push.web.unsubscribe     { endpoint }
//   push.web.test            { title?, body? }
//   push.web.preferences.get { endpoint }
//   push.web.preferences.set { endpoint, scope, preferences }
//
// `push.web.subscribe` requires a PAIRED BROWSER DEVICE IDENTITY — it reads the device
// id off the connection and refuses without one. The PWA already pairs as its own
// device (WebCrypto Ed25519, see lib/deviceIdentityWeb), so it qualifies; a device-less
// connection does not.

import { gatewayClient } from './gateway'
import { isElectron } from './platform'

// Which of the gateway's six categories this app can actually act on when you tap the
// notification. A category only belongs here once there is somewhere to land: a
// notification that opens onto nothing is worse than no notification.
//
// `humanMentioned` is multi-user and has no surface here, so it stays absent.
export const PUSH_CATEGORIES = [
  { key: 'agentFinished', label: 'Agent finished', hint: 'A run you started has completed.' },
  // Answerable since the approvals banner landed. It is app-global rather than a
  // section, so a tapped approval push needs no routing — focusing the app is enough,
  // which is why `approve/<id>` stays absent from pushUrlToNavigate.
  { key: 'approvalRequested', label: 'Approval needed', hint: 'A run is blocked until you allow or deny it.' },
  // Answerable since the question dock landed: an agent parked on question.resolve is
  // exactly the case worth waking a phone for, because nothing proceeds until you answer.
  { key: 'agentQuestion', label: 'Agent has a question', hint: 'A run is waiting on your answer.' },
  { key: 'scheduledTaskFailed', label: 'Automation failed', hint: 'A scheduled run ended in failure.' },
  { key: 'backgroundTaskFailed', label: 'Background task failed', hint: 'A background job ended in failure.' },
] as const

export type PushCategoryKey = (typeof PUSH_CATEGORIES)[number]['key']

// The gateway's full category set, needed because `preferences.set` takes a closed
// object: the ones we don't surface still have to be sent, as false.
export const ALL_PUSH_CATEGORIES = [
  'approvalRequested', 'agentFinished', 'agentQuestion',
  'humanMentioned', 'scheduledTaskFailed', 'backgroundTaskFailed',
] as const

export type PushDetailLevel = 'private' | 'identified' | 'detailed'

export interface PushCategoryPrefs { approvalRequested: boolean; agentFinished: boolean; agentQuestion: boolean; humanMentioned?: boolean; scheduledTaskFailed: boolean; backgroundTaskFailed: boolean }
export interface PushPrefs { categories: PushCategoryPrefs; detailLevel: PushDetailLevel; quietHours: { enabled: boolean; startMinute: number; endMinute: number; timeZone: string }; agentIds: string[] }

/** What this app turns on for a fresh subscription — see PUSH_CATEGORIES. */
export function defaultPushPrefs(): PushPrefs {
  return {
    categories: {
      approvalRequested: true,
      agentFinished: true,
      agentQuestion: true,
      humanMentioned: false,
      scheduledTaskFailed: true,
      backgroundTaskFailed: true,
    },
    detailLevel: 'identified',
    quietHours: { enabled: false, startMinute: 0, endMinute: 0, timeZone: localTimeZone() },
    agentIds: [],
  }
}

export function localTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

export function webPushSupported(): boolean {
  return !isElectron()
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

// VAPID keys arrive base64url; PushManager wants raw bytes. Kept exported and pure so
// the padding/alphabet handling is covered by a test rather than by trying it on a phone.
export function vapidKeyToBytes(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const raw = atob(withPad)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready
}

/** The browser's current subscription for this origin, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!webPushSupported()) return null
  try { return await (await registration()).pushManager.getSubscription() } catch { return null }
}

function subscriptionKeys(sub: PushSubscription): { p256dh: string; auth: string } | null {
  const json = sub.toJSON()
  const keys = json.keys
  if (!keys?.p256dh || !keys?.auth) return null
  return { p256dh: keys.p256dh, auth: keys.auth }
}

/**
 * Subscribe this browser and register it with the gateway.
 *
 * Both halves matter: a browser subscription the gateway doesn't know about receives
 * nothing, and a gateway registration whose browser subscription has been dropped is
 * a dead endpoint the gateway prunes on its next failed send.
 */
export async function subscribeToPush(): Promise<PushSubscription> {
  if (!webPushSupported()) throw new Error('Push is not supported in this browser')
  if (Notification.permission !== 'granted') throw new Error('Notification permission has not been granted')

  const { vapidPublicKey } = await gatewayClient.request<{ vapidPublicKey: string }>('push.web.vapidPublicKey', {})
  if (!vapidPublicKey) throw new Error('This gateway has no VAPID key configured')

  const reg = await registration()
  // Reuse an existing subscription when there is one: re-subscribing with a different
  // key silently invalidates the old endpoint and the gateway keeps pushing to a dead one.
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToBytes(vapidPublicKey),
    }))

  const keys = subscriptionKeys(sub)
  if (!keys) throw new Error('The browser returned a subscription without encryption keys')
  await gatewayClient.request('push.web.subscribe', { endpoint: sub.endpoint, keys })
  return sub
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  // Tell the gateway first — if the browser-side unsubscribe succeeds and this fails,
  // the gateway is left pushing into an endpoint that no longer exists.
  await gatewayClient.request('push.web.unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

export async function sendPushTest(): Promise<void> {
  await gatewayClient.request('push.web.test', {
    title: 'JoaxClaw',
    body: 'Background notifications are working.',
  })
}

export async function readPushPrefs(endpoint: string): Promise<PushPrefs | null> {
  try {
    const res = await gatewayClient.request<{ preferences?: PushPrefs }>('push.web.preferences.get', { endpoint })
    return res.preferences ?? null
  } catch { return null }
}

export async function writePushPrefs(endpoint: string, preferences: PushPrefs): Promise<void> {
  // scope 'user' stores against the durable gateway profile, so the choice follows you
  // to another device; 'device' would pin it to this browser only.
  await gatewayClient.request('push.web.preferences.set', { endpoint, scope: 'user', preferences })
}

// ── What the gateway actually pushes ────────────────────────────────────────────
//
// The payload is `{ title, body, tag, url?, renotify }`. `url` is present only for the
// categories that have somewhere to land, and it is the gateway's own Control UI path
// — RELATIVE (e.g. `automations?job=x&run=y`) when `gateway.publicOrigin` is unset, and
// an absolute Control UI URL when it is set. Per category, from the gateway's own
// event→notification map:
//
//   approval-requested      approve/<approvalId>
//   agent-question          ask/<questionId>        -> chat
//   scheduled-task-failed   automations?job=<jobId>&run=<runId> -> Automations
//   agent-finished          (no url — nothing to select, so just focus the app)
//   background-task-failed  (no url)
//
// We translate what we can onto our own sections and ignore the rest, rather than
// opening the gateway's Control UI over the top of this app.

export interface PushNavigate { section?: string; convId?: string }

/**
 * Map a gateway push `url` onto an in-app route. Returns undefined when the payload
 * points somewhere JoaxClaw has no view for — the caller should then just focus the
 * app, which is still the right outcome for a tapped notification.
 *
 * Accepts relative and absolute forms, since which one arrives depends on a gateway
 * config key we don't control.
 */
export function pushUrlToNavigate(url: unknown): PushNavigate | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined
  let path: string
  try {
    // A relative path needs a base to parse against; the base is then discarded.
    const parsed = new URL(url, 'https://placeholder.invalid/')
    path = parsed.pathname.replace(/^\/+/, '')
  } catch { return undefined }

  // The Control UI can live under a base path, so match the last segment group rather
  // than anchoring at the start.
  if (/(^|\/)automations$/.test(path)) return { section: 'crons' }
  // `ask/<questionId>`: the dock finds the pending question by session key on its own,
  // so this only has to put the user in the right section. It deliberately does not try
  // to resolve the id to a conversation — on a cold start from a push the questions
  // store has not loaded yet, so there would be nothing to look the id up in.
  if (/(^|\/)ask\/[^/]+$/.test(path)) return { section: 'chat' }
  return undefined
}

// Local (in-session) notifications for the PWA/web build.
//
// Tier 1: while the app is still in memory but not focused (you've switched apps,
// screen off), a finished reply / reminder / run raises an OS notification via the
// service worker (required for notifications on Android Chrome). Tapping it focuses
// the app and routes to the relevant view. Fully client-side — no gateway changes.
//
// Tier 2 (true push when the app is fully killed) needs Web Push + VAPID and the
// gateway pushing to a stored subscription; deferred until the gateway supports it.
//
// No-ops under Electron (the desktop app has its own window/tray).

import { isElectron } from './platform'
import { useSettingsStore } from '../store/settings'

export interface NotifyNavigate {
  section: 'chat' | 'processes' | 'teams' | 'crons'
  convId?: string
}

export function notificationsSupported(): boolean {
  return !isElectron()
    && typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  try { return await Notification.requestPermission() } catch { return 'denied' }
}

// One-line preview for a notification body: collapse whitespace, cap length.
export function notifyPreview(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean
}

interface NotifyOpts {
  title: string
  body?: string
  tag?: string
  navigate?: NotifyNavigate
  // Default true: only fire while the app is backgrounded, so we never nag over a
  // reply the user is already watching stream in.
  requireHidden?: boolean
}

export async function notify({ title, body, tag, navigate, requireHidden = true }: NotifyOpts): Promise<void> {
  if (!notificationsSupported()) return
  if (!useSettingsStore.getState().notificationsEnabled) return
  if (Notification.permission !== 'granted') return
  if (requireHidden && typeof document !== 'undefined' && document.visibilityState === 'visible') return
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, {
      body,
      tag,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { navigate },
      // Replace an earlier notification with the same tag rather than stacking.
      ...(tag ? { renotify: true } : {}),
    } as NotificationOptions)
  } catch { /* best-effort */ }
}

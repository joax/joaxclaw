// Platform detection + the single mobile/desktop switch the adaptive UI reads.
//
// This is the boundary that lets JoaxClaw be ONE responsive codebase instead of a
// desktop app and a separate mobile app. Adaptive components (AppShell, CodeEditor,
// Graph, …) read `usePlatform()` and render their desktop or mobile arm from it.
//
// Phase 0: the hook exists and is wired, but every adaptive seam still defaults to
// its desktop arm, so nothing changes on desktop yet — the swap points are just in
// place for the responsive/touch work to fill in.
import { useSyncExternalStore } from 'react'

export type Runtime = 'electron' | 'capacitor' | 'web'
export type OS = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown'

// Below this viewport width we use the mobile arm of adaptive layouts. 768px is the
// conventional tablet/phone boundary; a native mobile runtime is always "mobile"
// regardless of width.
export const MOBILE_BREAKPOINT = 768

interface Win {
  api?: { ws?: unknown }
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
}
const win = (): Win => (typeof window !== 'undefined' ? window : {}) as unknown as Win

// Electron exposes the preload bridge (`window.api.ws`); Capacitor exposes a global
// `window.Capacitor`; anything else is a plain browser/webview.
export function detectRuntime(): Runtime {
  const w = win()
  if (w.api?.ws) return 'electron'
  if (w.Capacitor?.isNativePlatform?.()) return 'capacitor'
  return 'web'
}

export function detectOS(): OS {
  const w = win()
  const cap = w.Capacitor?.getPlatform?.()
  if (cap === 'ios') return 'ios'
  if (cap === 'android') return 'android'
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  if (/mac/i.test(ua)) return 'macos'
  if (/win/i.test(ua)) return 'windows'
  if (/linux/i.test(ua)) return 'linux'
  return 'unknown'
}

// ── Reactive viewport width (useSyncExternalStore so it never tears) ──────────
function subscribeWidth(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}
function getWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1400
}

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribeWidth, getWidth, () => 1400)
}

export interface Platform {
  runtime: Runtime
  os: OS
  /** Running inside a native (Capacitor) shell — a real phone/tablet app. */
  isNative: boolean
  /** Use the mobile arm of adaptive layouts (native runtime OR narrow viewport). */
  isMobile: boolean
  /** Primary input is touch (native, or a browser that reports touch). */
  isTouch: boolean
}

export function usePlatform(): Platform {
  const width = useViewportWidth()
  const runtime = detectRuntime()
  const os = detectOS()
  const isNative = runtime === 'capacitor'
  return {
    runtime,
    os,
    isNative,
    isMobile: isNative || width < MOBILE_BREAKPOINT,
    isTouch: isNative || (typeof window !== 'undefined' && 'ontouchstart' in window),
  }
}

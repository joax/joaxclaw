// Am I running inside the Electron desktop shell, or a plain browser (PWA / mobile
// companion)? Electron sets "Electron/<ver>" in the UA. Used to hide desktop-only
// chrome (custom title bar + window controls) in the browser build.
export function isElectron(): boolean {
  if (typeof navigator === 'undefined') return false
  return /\belectron\//i.test(navigator.userAgent)
}

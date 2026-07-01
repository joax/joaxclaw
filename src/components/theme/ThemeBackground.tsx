import { useSettingsStore } from '../../store/settings'
import { useThemeImage } from './useThemeImage'
import type { ThemeBgSlot } from '../../lib/types'

// Renders the active theme's background image for a surface slot as a layer that sits
// above the surface's base colour but below its content. The host element must be
// `position: relative` and its real content must stack above (z-index ≥ 1). Renders
// nothing when the active theme has no image for this slot.
export function ThemeBackground({ slot }: { slot: ThemeBgSlot }) {
  const bg = useSettingsStore(s => s.themes.find(t => t.id === s.activeThemeId)?.backgrounds?.[slot])
  const url = useThemeImage(bg?.file)
  if (!bg?.file || !url) return null

  const tile = bg.fit === 'tile'
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: `url("${url}")`,
        backgroundSize: tile ? 'auto' : bg.fit,          // 'cover' | 'contain' | 'auto'(tiled)
        backgroundRepeat: tile ? 'repeat' : 'no-repeat',
        backgroundPosition: bg.position ?? 'center',
        opacity: bg.opacity,
        filter: bg.blur ? `blur(${bg.blur}px)` : undefined,
      }}
    />
  )
}

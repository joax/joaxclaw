import { describe, it, expect } from 'vitest'
import { parseThemeManifest, serializeTheme, isThemeColors, THEME_FORMAT, extOf } from '../themeFormat'
import type { ThemeSettings } from '../types'

const COLORS = {
  bgPrimary: '#0f1117', bgSurface: '#1a1d2e', bgElevated: '#232640',
  textPrimary: '#e2e8f0', textSecondary: '#94a3b8', accent: '#6366f1',
  accentFg: '#ffffff', border: '#2d3350', danger: '#ef4444', success: '#22c55e', warning: '#f59e0b',
}

describe('isThemeColors', () => {
  it('accepts a full valid palette', () => { expect(isThemeColors(COLORS)).toBe(true) })
  it('rejects a missing token', () => {
    const { accent, ...rest } = COLORS
    expect(isThemeColors(rest)).toBe(false)
  })
  it('rejects a non-hex value', () => {
    expect(isThemeColors({ ...COLORS, accent: 'rgb(0,0,0)' })).toBe(false)
  })
})

describe('parseThemeManifest', () => {
  it('parses a minimal valid manifest and fills scalar defaults', () => {
    const t = parseThemeManifest({ id: 'x', name: 'X', base: 'dark', colors: COLORS })
    expect(t).not.toBeNull()
    expect(t!.borderRadius).toBe(8)
    expect(t!.fontSize).toBe(14)
    expect(t!.iconFamily).toBe('lucide')
  })

  it('returns null without colors', () => {
    expect(parseThemeManifest({ id: 'x', name: 'X', base: 'dark' })).toBeNull()
  })

  it('returns null without an id (unless supplied via opts)', () => {
    expect(parseThemeManifest({ name: 'X', colors: COLORS })).toBeNull()
    expect(parseThemeManifest({ name: 'X', colors: COLORS }, { id: 'forced' })!.id).toBe('forced')
  })

  it('clamps out-of-range scalars and coerces a bad base/icon', () => {
    const t = parseThemeManifest({ id: 'x', base: 'neon', iconFamily: 'wingdings', borderRadius: 999, fontSize: 2, colors: COLORS })!
    expect(t.base).toBe('dark')
    expect(t.iconFamily).toBe('lucide')
    expect(t.borderRadius).toBe(40)
    expect(t.fontSize).toBe(10)
  })

  it('parses backgrounds with clamped opacity and a valid fit', () => {
    const t = parseThemeManifest({
      id: 'x', colors: COLORS,
      backgrounds: {
        app: { file: '/abs/app.jpg', opacity: 5, blur: 3, fit: 'contain' },
        chat: { file: '/abs/chat.png', fit: 'nonsense' },
        bogus: { file: '/abs/y.png' },
      },
    })!
    expect(t.backgrounds!.app!.opacity).toBe(1)      // clamped
    expect(t.backgrounds!.app!.fit).toBe('contain')
    expect(t.backgrounds!.chat!.fit).toBe('cover')   // coerced
    expect((t.backgrounds as Record<string, unknown>).bogus).toBeUndefined() // unknown slot ignored
  })

  it('drops a background with no file', () => {
    const t = parseThemeManifest({ id: 'x', colors: COLORS, backgrounds: { app: { opacity: 0.2 } } })!
    expect(t.backgrounds).toBeUndefined()
  })
})

describe('serializeTheme', () => {
  const base: ThemeSettings = {
    id: 'x', name: 'X', base: 'dark', colors: COLORS,
    borderRadius: 8, fontSize: 14, fontFamily: 'Inter', iconFamily: 'lucide',
  }

  it('stamps the format version and round-trips through parse', () => {
    const json = serializeTheme(base)
    expect(json.format).toBe(THEME_FORMAT)
    const back = parseThemeManifest(json)!
    expect(back.colors).toEqual(COLORS)
    expect(back.borderRadius).toBe(8)
  })

  it('rewrites background file paths to the zip-relative form by slot', () => {
    const json = serializeTheme({
      ...base,
      backgrounds: { app: { file: '/abs/whatever.JPG', opacity: 0.1, blur: 0, fit: 'cover' } },
    }) as { backgrounds: Record<string, { file: string }> }
    expect(json.backgrounds.app.file).toBe('backgrounds/app.jpg')
  })
})

describe('extOf', () => {
  it('lowercases and defaults', () => {
    expect(extOf('/a/b.JPG')).toBe('.jpg')
    expect(extOf('/a/b')).toBe('.png')
  })
})

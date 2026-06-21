# Branding — logo assets & usage

Where the JoaxClaw logo lives and how to use it in the UI, so views stay consistent
and placeholders don't ship as the real mark.

## Assets

| Asset | Path | Use |
|---|---|---|
| `logo-dark.png` | [src/assets/logo-dark.png](../src/assets/logo-dark.png) | **The in-app logo.** Imported by React components. |
| `logo.png` | [src/assets/logo.png](../src/assets/logo.png) | Light/master variant (same design). |
| `joaxclaw-logo.svg` | [resources/icons/joaxclaw-logo.svg](../resources/icons/joaxclaw-logo.svg) | Vector source. The `resources/icons/*` set (master/dark PNGs, platform icon folders) is for **packaging** (app/window/store icons), not the renderer. |

`src/assets/logo*.png` and `resources/icons/joaxclaw-logo-*.png` are byte-identical;
the design is the orange-claw "J". There is no separate "old vs new" *design* — the
only "old logo" in the app was an emoji placeholder (see below).

## Usage pattern

Import the asset and render an `<img>`; size with `height` + `width: 'auto'`:

```tsx
import logoUrl from '../../assets/logo-dark.png'
// …
<img src={logoUrl} alt="JoaxClaw" style={{ height: 56, width: 'auto' }} />
```

Existing call sites (mirror these for sizing): `TitleBar` (20px), `DashboardView`
(44px), `ConnectScreen` / `ReconnectOverlay` / chat empty-state (56px, often
`opacity: 0.9`).

The **nav rail** ([src/components/layout/NavRail.tsx](../src/components/layout/NavRail.tsx))
intentionally uses `lucide-react` glyphs (e.g. `MessageSquare` for Chats), **not** the
logo — don't swap those for the brand mark.

## Note — emoji placeholders are not branding

The chat empty-state ("Start a conversation") shipped a 🦞 emoji as a stand-in
"logo". It was replaced with the real `logo-dark.png`. When scaffolding a new empty
state, reach for the logo asset, not an emoji, if it's meant to read as the brand.

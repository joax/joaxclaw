# JoaxClaw Icon Pack

Master source:
- `joaxclaw-logo-master.png`
- `joaxclaw-logo-dark.png` for app UI on dark surfaces

Notes on the source:
- This master is a transparent raster cutout from the approved image version, so the small-size exports preserve the same detail instead of reinterpreting the mark as a new vector.
- The SVG in this folder is kept as an experimental sketch, but it is not the canonical export source.
- The dark variant keeps the same silhouette and raises the frame contrast for use inside the app on dark theme surfaces.

Generated outputs:
- iOS: `ios/joaxclaw-20.png`, `29`, `40`, `58`, `60`, `76`, `80`, `87`, `120`, `152`, `167`, `180`, `1024`
- Android: `android/mipmap-48.png`, `72`, `96`, `144`, `192`, `512`
- macOS: `macos/joaxclaw-16.png`, `32`, `64`, `128`, `256`, `512`, `1024`
- macOS fallback iconset: `macos/icon.iconset/`
- Windows: `windows/icon.ico` plus PNG exports at `16`, `24`, `32`, `48`, `64`, `128`, `256`
- Linux: `linux/joaxclaw-16.png`, `32`, `48`, `64`, `128`, `256`, `512`, `1024`

Notes:
- The logo uses a charcoal claw frame with a warm, compact `J` node core.
- This environment does not have an `.icns` writer installed, so the macOS bundle is provided as a full `icon.iconset/` plus PNG exports.

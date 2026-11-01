# Budget Terminal logo

**Fold is the selected Budget Terminal identity.** Its blue origami bird incorporates code brackets, code lines and three candlesticks, paired with an ivory serif wordmark.

The active files live in [`apps/desktop/resources`](../../../resources): `budget-terminal-fold.png` is the horizontal logo, `budget-terminal-icon.png` is the square 512px app icon, and `budget-terminal-icon.ico` contains Windows icons at 16, 24, 32, 48, 64, 128 and 256px. The title bar, favicon, Electron window, macOS dock, Windows Start Menu registration, Linux launcher installer and repository README use these assets. Windows Start Menu registration updates when the app next opens; existing Linux menu entries update with `npm run setup:linux`.

The original selected concept is preserved in `budget-terminal-option-7-fold.png`. Its prompt is recorded in [the second concept set](venture-logo-directions-2.md). The square icon was adapted from that reference using the built-in image generation tool; its source is `budget-terminal-fold-icon-source.png`, and its edit prompt is in [Fold icon production](fold-icon-production.md). Regenerate the platform encodings with `node scripts/export-branding.cjs` from the repository root.

`budget-terminal-logo.png` and the other numbered options are earlier concepts retained for reference.

Generated using the built-in image generation tool. This is a raster PNG, not a vector master. Keep its aspect ratio when resizing.

## Initial concept generation prompt (archived)

```text
Use case: logo-brand
Create one finished clean professional logo for "BUDGET TERMINAL", a desktop financial market research application.
Wide horizontal logo on an absolutely uniform solid very dark navy background #080b12.
Left: a simple original geometric cobalt-blue B-shaped symbol integrated with a terminal prompt chevron and a small emerald green vertical cursor. Bold, clever, compact, very few shapes, balanced negative space.
Right: exact text "BUDGET" over "TERMINAL", two tightly arranged lines, bold technical geometric sans-serif typography with precisely straight edges. BUDGET in pale silver #d5dee9, TERMINAL in cobalt blue #2f6fd0. Emerald accent #26c281 only for cursor.
Clean flat vector artwork aesthetic. All fills perfectly solid, all edges smooth and crisp. Generous canvas padding. Strong readable silhouette. Logo fills central 80 percent of width.
Absolutely no distressed texture, no scratches, no grain, no grunge, no roughness, no speckles, no paint, no gradients, no lighting, no bevels, no 3D, no shadows, no decorative elements, no extra text, no watermark, no mockup. One logo lockup only.
```

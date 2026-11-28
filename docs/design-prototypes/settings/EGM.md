# docs/design-prototypes/settings

## Overview
The Settings page prototype. `render.cjs` writes the prototype HTML and PNG renders. The existing `README.md` in this folder is human-written and is not replaced.

## Interface
- `render.cjs` - an Electron script. It writes `settings-prototype.html` and a PNG capture to the output folder ([render.cjs:writeFileSync]).
- `settings-prototype.html` - the prototype page.
- Images: `settings-compact.png`, `settings-implemented.png`, `settings-prototype.png`.

## Invariants
- Prototype output is reference material only.

## Side Effects
- Writes `settings-prototype.html` and a PNG when `render.cjs` runs ([render.cjs:writeFileSync]).
- Opens an Electron BrowserWindow to render the page ([render.cjs:BrowserWindow]).

## Verification
- Run: `npx electron docs/design-prototypes/settings/render.cjs` (manual; not part of the probe set)

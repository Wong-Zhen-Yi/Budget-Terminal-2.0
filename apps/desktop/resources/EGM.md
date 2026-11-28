# apps/desktop/resources

## Overview
Static application assets and one browser boot script for the mobile phone page. The folder contains the app icons, the logo image, the web manifest, and `mobile-boot.js`.

## Interface
- `budget-terminal-fold.png`, `budget-terminal-icon.png`, `budget-terminal-icon.ico` - logo and icon assets.
- `manifest.webmanifest` - web app manifest.
- `mobile-boot.js` - loads before the phone UI. If the page script or stylesheet fails, it reloads once. If loading still fails, or nothing opens within 30 seconds, it shows a reload button ([mobile-boot.js]).

## Invariants
- None verified in code beyond the reload behaviour in `mobile-boot.js`.

## Side Effects
- `mobile-boot.js` runs in the mobile browser and may reload the page.

## Verification
- Run: `npm run probe:mobile`

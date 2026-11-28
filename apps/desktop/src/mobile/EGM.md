# src/mobile (phone UI)

## Overview
The phone-browser UI. It reuses the same API and pages, with a navigation shell, a double-tap and touch layer, and a browser page for mobile. It is served by the mobile HTTP route in the main process ([CLAUDE.md:Architecture], [docs/mobile-access.md]).

## Interface
- `main.ts` - mobile entry point.
- `MobileShell.tsx:MobileHeader`, `MobileShell.tsx:MobileBrowserPage`, `MobileShell.tsx:mobileTelegramKey`.
- `MobileNavigation.tsx:MobileNavigation`.
- `client.ts:isMobileTerminal`, `client.ts:mobileTelegramProfile`, `client.ts:downloadMobileBackup`.
- `layout.ts:installMobileLayout`, `layout.ts:markEdges`.
- `touch.ts:installDoubleTap`, `touch.ts:touchShell`, `touch.ts:pointerText`.
- `useBrowserHistory.ts:useBrowserHistory`, `useBrowserHistory.ts:standaloneWebApp`, `useBrowserHistory.ts:reloadedPage`.

## Invariants
- The mobile client uses the same `DesktopApi` surface as the desktop, via `fetch('/api/call/<channel>')` ([CLAUDE.md:Single contract, three transports]).

## Side Effects
- `client.ts:downloadMobileBackup` downloads a backup file through the browser.
- `useBrowserHistory.ts` uses history APIs to manage navigation state.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:mobile`

# Deferred bug-fix task

Status: pending. Resume this task when the user has more usage credits and asks to run it. No execution date has been scheduled; this Markdown file does not execute itself.

## Instructions for the future run

Read AGENTS.md and inspect the current working tree before editing. Preserve unrelated changes, including existing MCP schema edits. Recheck each finding against the current code, implement the fixes, and add focused regression coverage using the repository's standalone probes. Follow the launcher-update requirement and preserve the existing palette and startup preloading behavior.

Do not delete this file at the start of the run. Delete bugs.md only after all three issues have been fixed (or verified already fixed), their regression checks pass, and the final changes have been reviewed. If work is interrupted or blocked, retain this file and record progress and remaining work here. Report the fixes, validation results, and deletion when finished.

## 1. P1: Failed imports can still replace local data

Location: apps/desktop/electron/services/provider.ts, importUserData, around lines 1969-1996.

The backup envelope accepts its sections as unknown values. The importer replaces holdings before validating and replacing articles. A later validation or write failure reports performed: false without restoring the stores already replaced. The renderer can therefore continue showing its old cache while disk contains a partially imported backup.

Confirmed reproduction: create an isolated APPDATA and LOCALAPPDATA, seed a portfolio named "Current local portfolio", and import a backup containing valid replacement holdings named "Imported replacement" plus articles: { articles: [{ id: "bad" }] }. The result reports performed: false and one error, but readPortfolios returns "Imported replacement".

Required result: validate every supplied section before changing any store, and make replacement failure recoverable across all affected stores. Preserve the complete pre-import state on failure. Reuse the existing sync journal/recovery approach where appropriate without creating nested save-queue deadlocks. Verify both invalid-section rejection and a failure after an earlier store has been written. Keep successful imports and older backups with optional sections working.

## 2. P1: Escape saves edits instead of cancelling them

Locations:

- apps/desktop/src/components/ui/NumberInput.tsx, Escape handler around line 91 and commit callback around line 50.
- apps/desktop/src/components/ui/TextInput.tsx, input Escape handler around line 113 and textarea handler around line 140.

The Escape handler queues a state reset and immediately blurs the input. The blur callback still closes over the edited draft and invokes onCommit with it. This can persist a financial value the user intended to discard.

Confirmed reproduction in a focused Electron window with the real components: edit NumberInput from 100 to 999, then press Escape; onCommit receives 999. Editing TextInput from "Original" to "Discard me" and pressing Escape similarly commits "Discard me", even though the displayed value initially resets.

Required result: Escape must restore the stored value and leave the field without invoking onCommit. Suppress the cancellation blur commit explicitly rather than relying on state-update timing. Cover number input, text input and wrapping textarea; also verify that Enter and ordinary blur still commit valid edits. Use a focused Electron fixture for UI verification; hidden/offscreen windows can fail to deliver focus events and conceal this bug.

## 3. P2: Embedded browser blocks public WebSocket connections

Location: apps/desktop/electron/services/browser.ts, publicRequest around line 73 and onBeforeRequest around lines 100-114; apps/desktop/electron/services/news/publicNetwork.ts, publicNewsUrl.

The resource request guard passes every URL through browserUrl/publicNewsUrl, which accepts only HTTP and HTTPS. Chromium WebSocket resource requests use ws/wss, so even connections to public hosts are cancelled. Websites that require WebSockets for live updates cannot function fully.

Confirmed reproduction using the actual configured request guard and a synthetic resolver returning a public address: https://www.example.com/api returns cancel: false, while wss://www.example.com/stream returns cancel: true.

Required result: distinguish navigation URLs from WebSocket resource URLs. Permit supported public WebSocket connections while retaining credential restrictions, private-address/DNS checks, and unsupported-scheme rejection. Do not broaden top-level navigation to arbitrary schemes. Cover public WSS acceptance, private WebSocket rejection, and existing HTTP(S) behavior with isolated fixtures.

## Validation context from the review

- npm.cmd run typecheck passed.
- npm.cmd run probe:loading --workspace budget-terminal-desktop passed.
- npm.cmd run probe:cloud-sync passed.
- npm.cmd run probe:controller failed twice at "Gamepad polling or React hook failed" after its mapping checks passed. Investigate the fixture's focus/visibility behavior before treating this as a product regression.
- apps/desktop/scripts/probe-data-correctness.ts stalled and was stopped; it did not provide a passing result.

All custom reproductions used temporary fixtures and isolated data directories. No fixes were implemented during the original review. Use npm.cmd on Windows if PowerShell blocks npm.ps1.

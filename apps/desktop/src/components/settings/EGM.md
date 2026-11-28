# src/components/settings

## Overview
Settings panels. Startup readiness, data health, cache, diagnostics, and provider status are shown here, not on the page banners ([AGENTS.md:No Global Diagnostics Banners]).

## Interface
- Data and status: `DataHealthPanel`, `CachePanel`, `ApiUsagePanel`, `DiagnosticLogsPanel`, `PageLoadOrderPanel`, `AppDashboard`.
- Accounts and sync: `UserDataPanel`, `CloudSyncPanel`, `MarketApiKeysPanel`, `MobileAccessPanel`, `McpPanel`.
- Preferences: `NavigationPanel`, `PrivacyPanel`, `ShortcutsPanel`, `ControllerControls`, `ClockPanel`.
- Layout: `SettingsSection`, `SectionHeader`.
- Constants: `API_CATALOG`, `LAUNCH_ON_STARTUP_LABEL`, `LAUNCH_ON_STARTUP_DESCRIPTION`.

## Invariants
- Provider diagnostics and readiness detail stay in this folder, not in page content ([AGENTS.md:Startup Page Readiness]).
- Market API keys are handled by the main-process `marketApiKeysHost.ts`, which uses `safeStorage` ([electron/services/EGM.md](../../../electron/services/EGM.md)).

## Side Effects
- `ApiUsagePanel`, `DiagnosticLogsPanel`, `MarketApiKeysPanel`, `MobileAccessPanel`, `PrivacyPanel`, and `ShortcutsPanel` call `window.api` or browser storage directly. Check them before changing data flow.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:settings-dashboard-ui` after `npm run build`

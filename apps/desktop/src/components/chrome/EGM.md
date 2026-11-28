# src/components/chrome

## Overview
Application chrome: the tab bar and tab picker, the top bar agent indicator, the status bar, the workspace sidebar and header, navigation icons, reload, symbol context menu, page cache indicators, and the MCP activity view.

## Interface
- Navigation: `TabBar`, `TabPicker`, `WorkspaceSidebar`, `WorkspaceHeader`, `NavigationIcon`, `pageIconPaths`.
- Status: `StatusBar`, `PortfolioChartsStatus`, `PageCache`, `TopBarAgent`, `McpActivity`.
- Actions: `ReloadButton`, `SymbolContextMenu`.

## Invariants
- The bottom status strip stays hidden ([AGENTS.md:No Global Diagnostics Banners]). Readiness detail belongs in Settings.

## Side Effects
- None (renders props or hook data). Reload triggers a renderer reload.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:readiness-ui` after `npm run build`

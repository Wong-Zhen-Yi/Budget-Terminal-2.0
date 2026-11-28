# electron/mcp (main-process bridge)

## Overview
The main-process side of the local MCP integration. A host starts a bridge. A dispatcher enforces permissions and journaling. Routes map service channels to MCP tools. Helpers cover screenshots, research snapshots, workflows, and the write journal.

## Interface
- `host.ts:startMcpHost`, `host.ts:getMcpStatus`, `host.ts:configureMcp`, `host.ts:invokeMcpTool`, `host.ts:cancelMcpCall`, `host.ts:testMcpConnection`, `host.ts:mcpClientSetup`, `host.ts:captureTerminalScreenshot`.
- `bridge.ts:startBridge`, `bridge.ts:BridgeOptions`.
- `dispatcher.ts:McpDispatcher`, `dispatcher.ts:McpAccessError`, `dispatcher.ts:DEFAULT_MCP_POLICY`.
- `routes.ts:createServiceRoutes`.
- `journal.ts:WriteJournal`, `journal.ts:receiptKey`.
- `snapshots.ts:ResearchSnapshots`.
- `workflows.ts:researchWorkflow`.
- `screenshot.ts:createScreenshotService`.

## Invariants
- `createServiceRoutes` throws at startup if a registered channel is neither in the MCP allowlist nor in `desktopOnlyChannels` ([routes.ts:createServiceRoutes], [routes.ts:desktopOnlyChannels]).
- MCP edits to saved records use compare-and-swap through `meta.revision` ([CLAUDE.md:Main process]).
- Permission policy defaults are defined in [dispatcher.ts:DEFAULT_MCP_POLICY].

## Side Effects
- Starts the local MCP bridge ([bridge.ts:startBridge]).
- Captures screenshots of the terminal window ([host.ts:captureTerminalScreenshot]).
- Writes the private write journal ([journal.ts:WriteJournal]).

## Verification
- Run: `npm run build:mcp`
- Run: `npm run probe:mcp`
- Run: `npm run typecheck`

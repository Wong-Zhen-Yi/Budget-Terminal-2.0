---
name: budget-terminal
description: Capture app pages, research markets and read or edit saved portfolios, options records, Cards, personal finance and settings in the running local Budget Terminal app.
---

Use Budget Terminal tools for data owned by the local app. Open Budget Terminal before service calls; connection status can diagnose availability. Arguments use a `request` object; pass `{ "request": {} }` for operations without parameters.

Use `budget_terminal_screenshot` with `{ "request": {} }` for the current page, `{ "request": { "page": "charts" } }` for a named tab, or `{ "request": { "page": "all" } }` for every implemented page, including tabs hidden from navigation. It returns PNG image blocks and page/status metadata. The app can be covered, hidden or minimized; capture does not focus or restore its window and restores the selected tab afterward. Screenshots show the current viewport and any loading/failure state; inspect metadata before assuming data is ready. Privacy blur is preserved. Prefer a single page when inspecting a specific issue.

Preserve source, snapshot time, freshness, partial coverage and errors when interpreting results. Prefer existing cached results; request `force` only when a fresh provider fetch is necessary. Calls share the app's provider rate gate.

Read a saved record before editing it and verify the returned record afterward. Portfolio and options edits record holdings and contracts; they never place broker orders. Deletion tools can remove records. If a connection is interrupted during a write, read the record before trying again; the write may have completed.

Bulk import/export, clearing all user data, and cache reset stay in the desktop app. The server has no arbitrary filesystem or shell tools. Local client execution is required; a local stdio package alone does not make this app available to cloud or web tasks.

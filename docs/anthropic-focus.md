# Anthropic Focus research

This private-company page is a reviewed research dossier with a live evidence watch. It does not fabricate a quote, public market capitalization, price chart or confirmed listing date. The reviewed November 10, 2026 roadshow describes an IPO application, not completed trading. Funding valuations, proposed offering prices, recognized revenue, annualized run-rate revenue, cash balances and multi-year commitments remain separately labelled.

The page has its own question index, demand-versus-compute chart, funding history, topic evidence cards, source-selection desk and update watch. All reviewed figures link to first-party disclosures. Quarter values are rounded USD billions from the November fact sheet. Compute is an expense subset; revenue less compute is not gross profit. Interim results are unaudited and adjusted margin is non-GAAP.

## Visual research views

Business pairs a selectable revenue/compute chart with customer-threshold bars and reported NRR. Customer counts are lower bounds for nested groups, not additive categories or exact customer shares. Capital shows financing valuations on an elapsed-time axis, separate fundraising bars and a liquid-resource breakdown. Economics switches between compute per revenue dollar and its reciprocal; both derive from rounded quarterly flows and exclude other expenses. The $1 reference is not operating break-even. Risks partitions compute obligations into non-overlapping horizons, subtracting the next-12-month amount from the through-2030 subtotal. Products maps direct work surfaces and developer/cloud access without inventing revenue mix.

All marks, figures and diagrams retain source access through the evidence desk. The structured `operatingMetrics` and `capitalSnapshot` fields carry source IDs and as-of dates for chart maintenance and MCP use. Cash, available credit and multi-year obligations remain distinct. The renderer query revision is incremented so older saved payloads reload before displaying the new visuals. Ratios and horizon partitions live in the React/Electron-free `electron/shared/anthropicCharts.ts`.

## Automatic checks

Every implemented page still starts loading on application startup. Anthropic uses a six-hour query/service TTL and shares the normal background preparation, F5 reload, persisted query snapshot and Settings diagnostics paths. Updates & sources provides a forced check. No key, paid feed, account or private data is needed.

The service checks the official news page, SEC submissions for CIK 2130357, and normalized main-content fingerprints of the reviewed roadshow, model release and safety policy. SEC registration coverage is opt-in, preserving the financial-report reader's existing default filtering. News dates bind to their own semantic article cards or JSON data; website JavaScript is never evaluated. Checks are bounded, timeout after 15 seconds for Anthropic documents, share the SEC limiter, and retain prior successful source snapshots on errors.

Research review reasons include new announcements or filings after `reviewedAt`, changes to a monitored document and the weekly review deadline. A clean check only means the watched sources were retrieved; it does not prove every fact is current. Headline and filing feeds update automatically. Curated facts, reporting periods and reviewed dates require a source review. There is no automatic financial extraction or unattended LLM rewriting. The app does not refresh when closed.

## Weekly research review

1. Inspect Updates & sources and open new announcements and SEC amendments. Confirm whether the offering remains proposed, has priced, has been withdrawn or has begun trading.
2. Compare the latest prospectus and financial/operating fact sheet with the page. Reconcile revenue periods, run-rate definitions, compute obligations and GAAP/non-GAAP measures. Do not sum overlapping funding commitments.
3. Update `electron/shared/anthropic.ts`: facts, quarterly values, funding events, source dates/URLs, `ANTHROPIC_REVIEWED_AT` and the next review date. The initial research review is November 15, 2026; its next review is November 22.
4. If a watched document has changed, inspect its content before updating `electron/shared/anthropicReviewedHashes.ts`. Use `anthropicDocumentHash` on the source HTML; the hash intentionally excludes scripts, styles, navigation and footer content. Never update hashes solely to clear a review flag. Add another watch source when a replacement model release or final IPO announcement supersedes the current one, updating the service, manifest and probe together.
5. Run `npm run probe:anthropic -- --live`, `npm run typecheck`, `npm run build`, `npm run probe:anthropic-ui --workspace budget-terminal-desktop` and `npm run probe:mcp`. Keep the three platform launchers on `scripts/launch.cjs`, which builds the desktop and local MCP plugin. Reconnect MCP clients after catalog/schema changes.

Live source failures remain explicit in the envelope and Settings. Curated research remains readable offline with its original review date. No global loading banner or bottom diagnostics strip is added.

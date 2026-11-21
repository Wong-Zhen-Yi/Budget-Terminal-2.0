# Anthropic Focus research

Anthropic began trading on the Nasdaq Global Select Market as ANT on November 19, 2026. The page links to Nasdaq for the quote and documents the $83 offer price, the November 20 IPO close and the concurrent Class N placement. Capital & listing distinguishes the total public offering proceeds from Anthropic’s own gross proceeds. Historical private financing valuations and September 30 liquidity retain their original dates. [Anthropic’s IPO closing announcement](https://www.anthropic.com/news/ipo-close)

The page has its own question index, demand-versus-compute chart, funding history, topic evidence cards, source-selection desk and update watch. All reviewed figures link to first-party disclosures. Quarter values are rounded USD billions from the November fact sheet. Compute is an expense subset; revenue less compute is not gross profit. Interim results are unaudited and adjusted margin is non-GAAP.

## Visual research views

Business pairs a selectable revenue/compute chart with customer-threshold bars and reported NRR. Customer counts are lower bounds for nested groups, not additive categories or exact customer shares. Capital shows financing valuations on an elapsed-time axis, separate fundraising bars and a liquid-resource breakdown. Economics switches between compute per revenue dollar and its reciprocal; both derive from rounded quarterly flows and exclude other expenses. The $1 reference is not operating break-even. Risks partitions compute obligations into non-overlapping horizons, subtracting the next-12-month amount from the through-2030 subtotal. Products maps direct work surfaces and developer/cloud access without inventing revenue mix.

All marks, figures and diagrams retain source access through the evidence desk. The structured `operatingMetrics` and `capitalSnapshot` fields carry source IDs and as-of dates for chart maintenance and MCP use. Cash, available credit and multi-year obligations remain distinct. The renderer query revision is incremented so older saved payloads reload before displaying the new visuals. Ratios and horizon partitions live in the React/Electron-free `electron/shared/anthropicCharts.ts`.

## Automatic checks

Every implemented page still starts loading on application startup. Anthropic uses a six-hour query/service TTL and shares the normal background preparation, F5 reload, persisted query snapshot and Settings diagnostics paths. Updates & sources provides a forced check. No key, paid feed, account or private data is needed.

The service checks the official news page, SEC submissions for CIK 2130357, and normalized main-content fingerprints of the IPO closing announcement, model release and safety policy. SEC registration coverage is opt-in, preserving the financial-report reader's existing default filtering. News dates bind to their own semantic article cards or JSON data. Checks time out after 15 seconds for Anthropic documents, share the SEC limiter, and retain prior successful source snapshots on errors.

Research review reasons include new announcements or filings after `reviewedAt`, changes to a monitored document and the weekly review deadline. A clean check only means the watched sources were retrieved; it does not prove every fact is current. Headline and filing feeds update automatically. Curated facts, reporting periods and reviewed dates require a source review. There is no automatic financial extraction or unattended LLM rewriting. The app does not refresh when closed.

## Weekly research review

1. Inspect Updates & sources for new announcements and SEC filings. Review new financial reports or changes to the share release schedule.
2. Compare the latest filings with the page. Reconcile revenue periods, run-rate definitions, compute obligations and GAAP and non-GAAP measures. Check for overlap before totaling funding commitments.
3. Update facts, quarterly values, funding events, source links and review dates in `electron/shared/anthropic.ts`. The November 21, 2026 review incorporated the final prospectus and IPO close. The next review is November 28.
4. Inspect any changed document before updating `electron/shared/anthropicReviewedHashes.ts`. Use `anthropicDocumentHash` on the source HTML to fingerprint the main text. When replacing a watched disclosure, update its source entry, fingerprint and probe together.
5. Run `npm run probe:anthropic -- --live`, `npm run typecheck`, `npm run build`, `npm run probe:anthropic-ui --workspace budget-terminal-desktop` and `npm run probe:mcp`. Keep the three platform launchers on `scripts/launch.cjs`, which builds the desktop and local MCP plugin. Reconnect MCP clients after catalog/schema changes.

Live source failures remain explicit in the envelope and Settings. Curated research remains readable offline with its original review date. No global loading banner or bottom diagnostics strip is added.

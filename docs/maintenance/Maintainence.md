# Budget Terminal maintenance checklist

Use the existing probes to check whether Budget Terminal starts reliably, shows current and correctly interpreted data, and keeps local records private. Run commands from the repository root.

| When | What to maintain |
| --- | --- |
| Weekly | **Market data and calculations.** Run `npm run probe:maintenance` and representative checks with `npm run probe:maintenance-live`. Investigate provider failures, rate limits, stale caches, and missing data. When a value looks wrong, verify currency, units, timestamps, and reporting periods against the source. See [public data routing](../public-data-routing.md). |
| Weekly and after relevant earnings or filings | **Focus page research.** Run `npm run probe:maintenance-live -- --focus`. Review changes to filing formats, segment definitions, and curated figures against primary sources. Anthropic headlines update automatically, and its curated facts require a weekly source review. See [Focus maintenance](../focus-maintenance.md) and the [Anthropic review workflow](../anthropic-focus.md). |
| Monthly and when relevant security advisories appear | **Dependencies, privacy, and recovery.** Review Electron, Node, and npm dependencies. Run the Browser, security, backup, and cloud-sync probes with isolated profiles. Verify that credentials, browser session data, and personal financial records stay out of the public repository, logs, and test artifacts. See [dependency maintenance](../dependency-maintenance.md) and [cloud sync](../convex-sync.md). |
| Every code change | **Launchers and regressions.** Update the Windows, macOS, and Linux double-click launchers and keep them on the shared build path. Run `npm run typecheck` and the affected probes. For startup or navigation changes, run `npm run probe:readiness-ui` and verify that every page preloads, switching shows ready content, and detailed failures appear in Settings. For visible changes, smoke-test the affected page at the normal viewport. See the [repository guidelines](../../AGENTS.md). |
| Every MCP-relevant change | **MCP parity.** Update affected tools, schemas, permissions, the local plugin, and docs alongside the app change. Run `npm run build:mcp` and `npm run probe:mcp`. Reconnect affected clients after catalog or schema changes. See [local MCP](../local-mcp.md). |

For a single recurring agent run, start with the weekly deterministic suite, representative live checks, and Focus source review. For each issue, record the affected page or provider, whether the issue is reproducible, and any fix verified by a rerun.

Review this checklist periodically. After each maintenance run, update it if the results reveal a missing check or a change to the commands, sources, or cadence.

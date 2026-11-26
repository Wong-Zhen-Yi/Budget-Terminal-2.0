# Budget Terminal maintenance checklist

Run commands from the repository root with a supported Node.js and npm version. [Development guide](../development.md), [runtime requirements](../../package.json)

## Weekly market data and Focus review

```sh
npm run probe:maintenance
npm run probe:maintenance-live
```

Use `--only=<name>` after `--` to rerun a single check. Add `-- --full-scans` to the live command when checking the full Quant and Technical Indicators scans. Investigate stale or partial data, rate limits and provider failures. When a value looks wrong, check its source, observation date, currency, units and reporting period. For equity fallback or streaming changes, run `npm run probe:finnhub` and use the provider-specific live probe as needed. [Public data routing](../public-data-routing.md), [Finnhub checks](../finnhub-streaming.md)

The `npm run probe:maintenance-live -- --focus` coverage check currently stops before fetching data. Macro, Ethereum and Homebuilders lack page-level tasks in that runner. Use the representative live run above for registered checks and supplement it with these commands while coverage is incomplete.

| Focus page | Checks |
| --- | --- |
| Macro | `npm run probe:maintenance-live -- --only=economic,calendarMonth,treasurySource` checks related source data. After building, `npm run probe:macro-ui` checks the page. |
| Ethereum | `npm run probe:public-providers -- --eth-live` checks network activity, market history, staking and fee burn. After building, `npm run probe:eth-ui --workspace budget-terminal-desktop` checks the page. |
| Homebuilders | `npm run probe:homebuilders -- --live` checks quotes and adjusted history for representative builders and benchmark ETFs, plus builder profiles. After building, `npm run probe:homebuilders-ui` checks the page. |

Review issuer research weekly and after relevant earnings or filings. Check filing formats, segment definitions and curated figures against primary disclosures. For Anthropic, inspect **Updates & sources** for new SEC filings and official announcements, including IPO and listing disclosures. The app refreshes headlines and filings while running. Curated figures, reporting periods and review dates require a source review. [Focus probes](../focus-maintenance.md), [Anthropic review workflow](../anthropic-focus.md)

## Monthly dependency, privacy and recovery checks

Review Electron, Node.js and npm dependencies each month and when relevant security advisories appear. Build before running the Browser and security checks. The maintenance runner uses temporary profiles for these checks.

```sh
npm audit
npm run build
npm run probe:maintenance -- --ui --only=backup,browser,security,cloud-sync,cloud-auth,cloud-session,auth-policy
```

Verify backup recovery, cloud sign-in and session isolation. Keep credentials, Browser session data and personal financial records out of the public repository, logs and shared artifacts. [Dependency maintenance](../dependency-maintenance.md), [Browser](../browser.md), [cloud sync](../convex-sync.md)

## Changes and release checks

- Update `launchers/windows/Launch Budget Terminal.cmd`, the only double-click launcher, for each change. Keep it on the shared build path and run `npm run probe:launcher`. Demo and phone previews start from `btd -Demo` and `btd -MobilePreview`, not from launchers. For app update changes, check **Settings → App dashboard → Check for updates**. Installation requires a clean `main` checkout that can be fast-forwarded. Reopen the app with a launcher to build the updated desktop and MCP source. `btd restart` waits for pending saves, rebuilds and reopens the app. [Update Budget Terminal](../../README.md#update-budget-terminal)
- Run `npm run typecheck` and the affected offline probes for code changes. Use the relevant live probe for provider changes. After building, run `npm run probe:readiness-ui` for startup or navigation changes. Verify that every implemented page preloads, switching shows ready content, and Settings shows detailed failures. Smoke-test visible changes at the normal viewport and check that loading or refresh keeps the controls and content in place. [Repository guidelines](../../AGENTS.md)
- For MCP-relevant changes, update the affected registry entries, routes, schemas, permissions, local plugin and documentation. Run `npm run build:mcp` and `npm run probe:mcp`. Reconnect affected clients after catalog or schema changes. [Local MCP](../local-mcp.md)

Review offline and live reports under `apps/desktop/out/maintenance/`. For each issue, record the affected page or provider, the check and outcome, whether the issue can be reproduced, and any fix verified by a rerun. Update this checklist when the commands, coverage, sources or cadence change. [October 2026 maintenance results](2026-10-07.md)

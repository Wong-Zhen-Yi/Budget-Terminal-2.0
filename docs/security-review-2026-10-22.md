# Security review — 22 October 2026

Scope: repository source, npm lockfile, Electron renderer/browser isolation, IPC, local MCP authentication, browser-profile privacy, and startup behavior. This is a targeted source review and regression run; external providers and the entire host were not penetration-tested.

## Changes

| Observation | Change | Verification |
| --- | --- | --- |
| Production HTML allowed connections to arbitrary localhost HTTP/WebSocket ports. | Remove local-service allowances from production CSP; allow development WebSockets only during Vite serve. Disable base URL changes, forms, object embeds and frames in the shell. | Real Electron CSP violation events verify blocked inline scripts, base changes and local connections. |
| The development server inherited access to the wider npm workspace. | Bind explicitly to loopback and restrict served files to renderer source, shared contracts and dependencies. Deny environment files, key/certificate files, Git metadata and MCP descriptors. | Real Vite HTTP requests reject main-process files and the root manifest with 403; shared modules and HMR HTML remain available. |
| Browser HTTP filtering did not restrict direct WebRTC UDP. | Set `disable_non_proxied_udp` on each research tab. | Real browser probe checks the policy, isolation, navigation, reading, screenshots and Stop behavior. |
| External URL validation accepted embedded credentials and URL parser coercion/control characters. | Accept bounded HTTP(S) strings without credentials or literal whitespace/control characters. | Valid encoded links pass; malformed values, credential URLs and unsafe schemes fail. |

These are configuration and validation improvements. No working exploit against saved user records was demonstrated during this review.

## Dependency updates

| Package | Previous | Installed |
| --- | --- | --- |
| Electron | 44.9.0 | 44.9.3 |
| Vite | 8.3.4 | 8.3.5 |
| @tanstack/react-query | 5.104.3 | 5.104.5 |
| @tanstack/react-query-persist-client | 5.104.3 | 5.104.5 |
| hyparquet | 1.31.4 | 1.31.5 |
| yahoo-finance2 | 4.0.4 | 4.0.5 |

Manifest minimums and the lockfile are updated. Electron remains on the supported 44 release line; the newly released 45.0.0 major was not adopted. [Electron 44.9.3 release notes](https://github.com/electron/electron/releases/tag/v44.9.3) list upstream ANGLE, Chromium, PDFium, Skia and V8 fixes.

The npm audit bulk and quick endpoints timed out, so an npm audit result could not be established. As a fallback, all **427 unique npm package/version pairs** in the updated lockfile were queried against the [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/). Response counts and per-query errors were checked: **zero known advisories returned**. The eight replaced package/version pairs also returned zero, so this review does not attribute a specific CVE to the previous dependency set. Advisory coverage can lag newly published problems and does not fully characterize bundled browser-engine security.

A high-confidence credential-pattern scan of 521 tracked production text files found no matches. The separate privacy probe passed tracked-file, ignore-rule and outgoing-history checks using synthetic credential/profile fixtures.

## Validation

- `npm run ensure:electron` — installed runtime reports 44.9.3.
- `npm run typecheck` and `npm run build` — passed.
- `npm run probe:security --workspace budget-terminal-desktop` — passed real Vite restrictions, production CSP, sandboxed preload, trusted IPC and local MCP integration.
- `npm run probe:browser --workspace budget-terminal-desktop` — passed browser security and UI smoke checks; ignored screenshots inspected.
- `npm run probe:agent-privacy` and `npm run probe:launcher` — passed.
- `npm run probe:mcp` — passed 90 tools, 44 mutation variants, authentication, validation, restart and shutdown checks.
- `npm run probe:news -- --offline` — passed public-IP filtering, DNS rebinding/mixed-answer rejection, redirects and response limits.
- `npm run probe:charts -- --offline` — passed after correcting a date-dependent weekly fixture to use distinct weeks.
- `npm run probe:readiness-ui` — passed all 49 routes after completed startup, empty/populated portfolios and persisted selections, without first-visit loads.
- `npm run probe:cache-ui` — passed persistence, startup reuse, selective refresh, privacy and bounded close behavior.
- `npm run probe:stocks -- AAPL` — passed live provider verification with an isolated temporary data profile and no provider failures.

## Remaining boundaries

- Browser DNS validation precedes Chromium's connection. It remains defense in depth, with no guarantee against all DNS rebinding or non-HTTP paths; see [browser limitations](browser.md#isolation-and-limitations).
- Browser agent access defaults to on. Requested reads/screenshots of signed-in pages can disclose visible content to the selected agent provider or MCP client. Existing access controls and privacy hiding remain in place.
- The local MCP bridge permits authenticated local clients to invoke its published tools. Tests verify bearer-token, Origin and Host restrictions; local same-user compromise remains outside that boundary.
- No destructive attack was run against real user data or third-party services. Zero advisory matches is not a guarantee that the application has no security flaws.

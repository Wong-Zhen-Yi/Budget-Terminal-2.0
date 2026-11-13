# Dependency maintenance — 13 November 2026

Updated 14 direct dependencies within their existing major versions and refreshed the npm lockfile. Electron is now 45.3.1; Vite is 8.3.8. All three double-click entry points reference this maintenance record and continue to install dependencies and rebuild through the shared launcher.

## Security fixes

The initial npm audit reported five moderate package findings, with no high or critical findings. The final audit reports zero known vulnerabilities across production and development dependencies.

- MCP SDK transitive dependencies now resolve to hono 4.13.18 and @hono/node-server 2.1.8.
- ts-json-schema-generator 2.9.0 still requests glob 13. Root overrides narrowly replace its glob dependency with ^14.0.6, resolving minimatch 11.0.8. This addresses [glob cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch resource amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249). Remove the override when the generator adopts a patched glob release. Its globSync API, generated schemas, production build and complete MCP probes were verified.

Kept @convex-dev/auth 0.0.96: version 2 requires an authentication migration and adds Next.js/Resend peers. Preserved the existing exact @tanstack/react-virtual 3.13.12 pin. Neither has an npm audit finding. These are the only remaining entries from npm outdated.

## Bug found

The Charts UI probe imported the removed useReloadAll hook, preventing it from running. It now exercises targeted forced refresh through trackPageQuery and verifies that refreshing MSFT leaves unrelated holdings alone. The complete chart UI probe passes.

## Validation

Used the managed Node 24.22.1 runtime because the default shell Node 24.13.0 does not satisfy the repository security floor.

Passed: typecheck; production build; Electron runtime verification; offline charts; live AAPL stock service (no provider failures); cloud sync; cache; loading; MCP; security; Browser; certificates; launchers; desktop startup; Charts UI. Security checks include loopback-only development serving, CSP enforcement, isolated sandboxed preload, trusted IPC, Browser profile isolation, content approval and screenshot privacy. Startup checks retain preloading for every implemented page. Persistence probes use temporary profiles.

No application security claim extends beyond the audit database and checks listed above. Electron emits a safeStorage synchronous API deprecation notice during startup; migration to its asynchronous API remains future maintenance.

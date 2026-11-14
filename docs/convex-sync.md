# Convex Auth v2 and optional cloud sync

Budget Terminal reads and writes its local stores first. Convex is an optional remote copy; no account or internet connection is required to use the application. Startup preloads every implemented page independently of cloud sign-in. Sync progress and failures appear only in Settings.

## Configure with the CLI

Use the repository's existing Convex project when upgrading. From the repository root:

```sh
npm install
npm run convex:setup
```

The setup command uses the deployment selected in the ignored `apps/desktop/.env.local`. It generates component bindings, runs the application typecheck, exports the complete existing deployment (including file storage) outside the repository, deploys the v2 components and functions, and checks public authentication configuration. It stops before deployment if the typecheck, credentials check or recovery export fails. The compiler runs through the workspace's resolved TypeScript installation because Convex's built-in compiler lookup does not resolve hoisted npm dependencies.

The private recovery ZIP is stored under `BudgetTerminal/convex-backups` in LOCALAPPDATA on Windows (or the user's home directory otherwise). It contains sensitive account and saved data. Never upload it to Git or share it publicly. Environment variables are not part of this export; setup preserves the existing provider credentials and legacy signing configuration.

For a new project, run `npm run convex:dev` to authenticate the CLI and select/create the deployment, then stop the watcher after project selection. Configure the following deployment environment variables in the Convex dashboard or using `npx convex env set` from `apps/desktop`, and run `npm run convex:setup`:

| Variable | Backend-only value |
| --- | --- |
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret |

The existing variable names are retained so an upgrade reuses the deployment's GitHub OAuth App. They are bound to the v2 GitHub component's `CLIENT_ID` and `CLIENT_SECRET`. Neither value is returned by the app's configuration query. `authConfiguration` exposes only `authVersion: 2` and `githubConfigured`.

Register this authorization callback URL on the GitHub OAuth App, using the deployment's exact site host (including a regional label if present):

```text
https://YOUR-DEPLOYMENT.convex.site/api/auth/callback/github/callback
```

This callback is served by the mounted v2 GitHub component. Register the full exact URL, including the final `/callback`; the old v1 `/api/auth/callback/github` URL does not match when exact matching is enabled. You may keep the old registration alongside the v2 URI. Keep wildcard matching disabled. Setup prints the deployment's actual callback URL for registration. See [GitHub redirect URL matching](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#redirect-urls).

If GitHub displays **Invalid Redirect URI** or **The redirect_uri is not associated with this application**, open that OAuth App's **General > Redirect URIs**, add the exact v2 callback URL and click **Update application**. Cancel the pending sign-in in Budget Terminal and start a fresh one. A signed-out HTTP redirect to GitHub's `/login` does not validate callback registration: GitHub can defer the error until after login. The CLI cannot verify this GitHub account setting.

V2 uses the deployment's built-in signing keys. Do not generate `JWT_PRIVATE_KEY` or `JWKS` for v2, run a v1 scaffolder, or put administrator keys in the renderer. Existing v1 signing variables may remain unused for rollback. `CONVEX_SITE_URL` and `CONVEX_CLOUD_URL` are managed by Convex.

Useful root commands:

```sh
npm run convex:codegen           # Refresh generated bindings without deploying
npm run convex:dev               # Watch and deploy development changes
npm run convex:setup             # Back up, check and upgrade configured development
npm run convex:deploy            # Back up, check and deploy production explicitly
npm run probe:convex-auth-live   # Validate the configured development auth endpoints
```

Production is separate: configure its own GitHub OAuth App and variables first. `convex:deploy` exports production before deploying it. Upgrading development does not update production.

## Reconnect after a v1 upgrade

1. Relaunch Budget Terminal using any double-click launcher.
2. Open **Settings > Data & storage > Cloud sync**.
3. Enter the exact `.convex.cloud` deployment URL and choose **Sign in with GitHub**. Regional hosts are supported.
4. Approve in your system browser and return to the application. Repeat on each device with the same GitHub account.

V1 sessions cannot be reused as v2 sessions. An encrypted legacy session is left intact until a successful replacement or explicit disconnect, but the app asks for a new GitHub sign-in. The deployment URL is remembered. Local data and sync checkpoints remain available.

The internal user-creation callback looks up the verified, stable GitHub provider ID in the retained v1 `authAccounts` table. If present, it returns that original user ID, preserving snapshot ownership and archived records. New GitHub accounts receive a new empty user row. Email addresses, login names and display names never link accounts. Legacy auth and record-era tables and indexes are retained for recovery; no v1 sign-in endpoints are deployed.

Convex Auth v2 currently lacks the old standalone email-code sign-in method, so the desktop now offers GitHub only. An email-only legacy account without a linked GitHub identity needs a separately reviewed account migration; an email match does not prove ownership. Do not create a new cloud copy over that account's saved data. Local saves and recovery exports remain available.

The Convex developer CLI login is separate from Budget Terminal user sign-in. Other devices only need the application, deployment URL and GitHub account, with no developer credentials.

## Desktop authentication and privacy

Signed-out users see an account popup on the front screen at launch. **Sign in** and **Sign up** both use the existing GitHub flow; the first successful sign-in creates the account. Sign-in persists by default: encrypted credentials are restored before the first renderer account check, so a signed-in user skips the popup. Browser approval closes it automatically. **Continue locally**, the close button or Escape dismisses it for this app session. **Don’t show again** saves a device-only preference across restarts; **Settings → Cloud sync → Show sign-in popup at startup** restores it. Sign-in remains available in Settings even with the popup disabled. Without a saved deployment URL, the popup asks for the URL of the user's cloud setup. All implemented pages continue preloading behind the popup. Account status is checked live and excluded from the persisted renderer market cache.

Authentication runs in Electron's main process behind `window.api`. OAuth state, one-time codes, access tokens and refresh tokens never enter the renderer, local MCP tools or browser response text. Sessions are encrypted with Electron safeStorage in `sync-session.bin`; a working OS keyring is required and plaintext storage is refused.

V2 requires an explicit redirect-origin allowlist. The desktop binds only `127.0.0.1`, trying ports 43871 through 43875, and uses a fresh random 256-bit callback path for each attempt. Only those five loopback origins are allowed by the backend. If all ports are occupied, sign-in fails safely. The listener validates the Host, path, method, parameter names and duplicate parameters, and closes after success, cancellation or five minutes. Provider cancellation and expiry return to Settings immediately.

Before opening the system browser, the app validates GitHub's HTTPS authorization host and path, the deployment-specific callback, state and PKCE parameters. Completion presents the one-time code with the initiating state to `completeSignInWithGithub`. V2 `refreshSession` rotates credentials serially and the replacement is encrypted before use. `noSession` removes expired local credentials and asks for sign-in. Disconnect removes local credentials first and attempts server revocation with the refresh token. Backend data reads resolve a live v2 session through the auth component, so a revoked session cannot access snapshots even if its access token has not expired.

## Local saves, sync and recovery

Synced: portfolios and options, personal finance, custom cards, articles, charts watchlists and shared preferences. Browser profiles, cookies, provider keys, agent histories, market caches and device paths stay on the device.

The first device uploads if the cloud is empty. A fresh device with only factory defaults restores the cloud snapshot. Existing devices with competing edits require **Keep this device's copy** or **Use cloud copy**, followed by explicit confirmation. A selection must be confirmed again if either copy changes. Records from competing snapshots are not merged.

Local edits save without waiting for network requests. Durable edit timestamps and the last acknowledged checkpoint preserve pending work across restarts. Server revisions order changes independently of device clocks; accepted updates have strictly increasing server timestamps. An authenticated subscription and a 15-second background check detect changes and retry failures.

Downloads validate all stores, save a recovery backup, check for intervening local edits and journal the replacement. An interrupted replacement rolls back before the next window opens. Recovery copies live under the private application-data `sync-backups` directory. Disconnect keeps local data and the cloud copy. Complete snapshots have a 750 KB UTF-8 payload limit; larger libraries continue working locally and show a sync error.

## Verification

```sh
npm run typecheck
npm run probe:cloud-oauth
npm run probe:auth-ui
npm run probe:cloud-sync
npm run probe:convex-auth-live
npm run probe:settings-ui --workspace budget-terminal-desktop
npm run build
npm run probe:mcp
npm run probe:launcher
```

Offline probes exercise the real callback listener, state-bound redemption, hostile requests, allowed-port fallback, cancellation, account linking, revoked-session isolation, snapshot conflicts and recovery. The live probe checks the deployed v2 component endpoints, the signed-out GitHub login entry, callback routing and rejection of unauthorized access. It creates only an expiring OAuth request and does not modify saved user data. It explicitly does not verify GitHub callback registration. A completed browser login, successful token rotation and authenticated cross-device sync require a signed-in browser and are not claimed by that probe.

Deployment on 2026-11-14: the locally configured development backend was exported privately and upgraded to the `auth` and `authGithub` components. Existing GitHub variables and legacy records were retained. Production was not changed.

Callback repair on 2026-11-14: the development GitHub OAuth App still registered only the exact v1 URI. The exact v2 URI was added alongside it with wildcard matching left disabled. A signed-in browser completed the real v2 flow; authenticated access found the existing cloud snapshot, token rotation preserved the user identity, and revoking the temporary test session immediately blocked snapshot access. No saved user data was changed and no credentials were saved by this check.

References: [Convex Auth v2 setup](https://docs.convex.dev/auth/convex-auth/getting-started), [GitHub OAuth](https://docs.convex.dev/auth/convex-auth/methods/oauth), [v1 migration status](https://docs.convex.dev/auth/convex-auth/migrating/from-convex-auth-v1).

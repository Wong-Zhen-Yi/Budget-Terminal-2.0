# Convex Auth v2 and optional cloud sync

Budget Terminal reads and writes its local stores first. Convex is an optional remote copy; no account or internet connection is required to use the application. Startup preloads every implemented page independently of cloud sign-in. Sync progress and failures appear only in Settings.

Every installation uses the same Budget Terminal cloud deployment. To connect a device, choose **Sign in with Google** on the startup screen or in **Settings > Data & storage > Cloud sync**. Use the same Google account on each device to access the same cloud workspace.

GitHub sign-in was removed on 2026-11-25 (see [Retired GitHub sign-in](#retired-github-sign-in)). Accounts created with GitHub are not reachable from Google; a device that was signed in with GitHub keeps its local data and can import it into a Google account.

The desktop uses the existing deployment that passed two-device sign-in and sync acceptance. This restores access to accounts and cloud copies created before the production rollout attempt.

## Configure cloud deployments with the CLI (operators)

Use the repository's existing Convex project when upgrading. From the repository root:

```sh
npm install
npm run convex:setup
```

The setup command uses the Convex CLI's deployment selection, which normally lives in the ignored `apps/desktop/.env.local`. It also accepts a deployment-scoped `CONVEX_DEPLOY_KEY` in the environment or that file. It generates component bindings, runs the application typecheck, exports the complete existing deployment (including file storage) outside the repository, deploys the v2 components and functions, and checks public authentication configuration. It stops before deployment if the typecheck, credentials check or recovery export fails. The compiler runs through the workspace's resolved TypeScript installation because Convex's built-in compiler lookup does not resolve hoisted npm dependencies.

The private recovery ZIP is stored under `BudgetTerminal/convex-backups` in LOCALAPPDATA on Windows (or the user's home directory otherwise). It contains sensitive account and saved data. Never upload it to Git or share it publicly. Environment variables are not part of this export; setup preserves the existing provider credentials and legacy signing configuration.

For a local Convex deployment, use `npm run convex:dev`. To export local data, run `npx convex export --include-file-storage --path <private-backup.zip>` from `apps/desktop` while that development process is running. Local database files under `.convex/` are ignored by Git.

For a new project, run `npm exec --workspace budget-terminal-desktop -- convex init` from the repository root to select or create the deployment before pushing functions. Configure the following deployment environment variables in the Convex dashboard or using `npx convex env set` from `apps/desktop`, and run `npm run convex:setup`:

| Variable | Backend-only value |
| --- | --- |
| `AUTH_GOOGLE_ID` | Google OAuth web client ID (ends in `.apps.googleusercontent.com`) |
| `AUTH_GOOGLE_SECRET` | Google OAuth web client secret |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | Retained values for the dormant GitHub component (see below) |

`convex.config.ts` declares all four, so a deploy without any of them fails, and `convex:setup` stops before exporting or deploying if one is missing. The Google pair is bound to the Google component's `CLIENT_ID` and `CLIENT_SECRET`. No value is returned by the app's configuration query. `authConfiguration` exposes only `authVersion: 2`, `accountControlsVersion: 2` and `googleConfigured`. The desktop checks both capability versions and `googleConfigured` before opening the browser, so an unconfigured backend shows "Google sign-in is not available" instead of starting OAuth.

### Retired GitHub sign-in

GitHub sign-in was removed on 2026-11-25. The backend no longer exports `startSignInWithGithub`, `completeSignInWithGithub`, the GitHub SDK adapter or the GitHub user hooks, so no client can start or redeem a GitHub flow. Pending OAuth requests without a provider, or tagged `github`, never match a Google completion.

The `authGithub` component stays mounted with no sign-in entry point. Unmounting it would delete its GitHub-ID-to-account links on the next deploy, so it is kept to allow a reviewed restoration later. For the same reason, the existing `AUTH_GITHUB_*` values must stay set on the deployment. Do not delete them. The schema still accepts `githubLogin`, `authProvider: 'github'` and `provider: 'github'` on existing rows. Cloud copies owned by GitHub accounts are retained on the server but are not reachable from a Google sign-in.

On the desktop, a saved session with provider `github` (or no provider, from before Google sign-in) is never restored. Startup erases it, writes the sign-out marker, and revokes the session on the server in the background without delaying startup; the marker records whether that revocation was confirmed. Settings and the startup popup then ask for a Google sign-in. Local data is untouched and syncs with the Google account as soon as the user signs in (see [Local saves, sync and recovery](#local-saves-sync-and-recovery)).

### Google OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create a project for Budget Terminal.
2. Open **Google Auth Platform > Branding** (or **APIs & Services > OAuth consent screen**) and configure the consent screen. Use the **External** audience. Only the `openid`, `email` and `profile` scopes are requested, none of which need Google verification. While the app is in **Testing**, only listed test users can sign in. Publish it to **In production** to allow any Google account.
3. Open **Clients > Create client** (or **Credentials > Create credentials > OAuth client ID**) and choose **Web application**. The desktop never talks to Google directly: Google returns to the Convex deployment, which then redirects to the loopback listener. So use the web type, not the Desktop type.
4. Under **Authorized redirect URIs**, add the deployment's exact Google callback. No JavaScript origins are needed:

   ```text
   https://YOUR-DEPLOYMENT.convex.site/api/auth/callback/google/callback
   ```

5. Copy the client ID and secret into the deployment from `apps/desktop`. Keep them out of the repository, the renderer and chat logs:

   ```sh
   npx convex env set AUTH_GOOGLE_ID <client-id>.apps.googleusercontent.com
   npx convex env set AUTH_GOOGLE_SECRET <client-secret>
   ```

6. Run `npm run convex:setup`. It prints the Google callback URL, and its preflight fails unless `googleConfigured` is true and GitHub sign-in is no longer advertised. `googleConfigured` refuses a client ID that does not end in `.apps.googleusercontent.com` or that equals the secret.
7. Run `npm run probe:convex-auth-live`. Google validates `client_id` and `redirect_uri` before sign-in, so a `redirect_uri_mismatch` (HTTP 400) is caught there without a browser.

If Google displays **Error 400: redirect_uri_mismatch**, the Authorized redirect URI does not byte-match the callback above. Check the regional host label and the final `/callback`. Google can take a few minutes to apply a changed client.

Production needs its own Google client, or its own redirect URI on the same client, plus its own `--prod` variables.

V2 uses the deployment's built-in signing keys. Do not generate `JWT_PRIVATE_KEY` or `JWKS` for v2, run a v1 scaffolder, or put administrator keys in the renderer. Existing v1 signing variables may remain unused for rollback. `CONVEX_SITE_URL` and `CONVEX_CLOUD_URL` are managed by Convex.

Useful root commands:

```sh
npm run convex:codegen           # Refresh generated bindings without deploying
npm run convex:dev               # Watch and deploy development changes
npm run convex:setup             # Back up, check and upgrade configured development
npm run convex:deploy            # Back up, check and deploy production explicitly
npm run probe:convex-auth-live   # Validate the desktop's shared auth endpoints
```

Production is separate: configure its own Google OAuth client and variables first. `convex:deploy` exports production before deploying it. Upgrading development does not update production.

## Reconnect after a v1 upgrade

1. Relaunch Budget Terminal with `Launch Budget Terminal.cmd` or `btd`.
2. Open **Settings > Data & storage > Cloud sync**.
3. Choose **Sign in with Google**.
4. Approve in your system browser and return to the application. Repeat on each device with the same Google account.

V1 sessions and sessions issued by a different deployment require a fresh Google sign-in. The encrypted session is preserved until successful replacement or explicit disconnect. Local data and sync checkpoints remain available. If this device previously synced with another deployment, its cloud copy stays there. After signing in, this device syncs with the shared cloud automatically under the first-sync rules below.

Google accounts are keyed by Google's stable `sub` claim. `createGoogleUser` reuses a retained v1 `authAccounts` row for the same Google `sub` if one exists. Otherwise it creates a new empty user. Email addresses and display names never link accounts, so a Google sign-in never joins an account created by the retired GitHub sign-in. Account settings show the Google address only when Google marks it verified (`googleEmail` on the user row). Session-management verification ("Sign out other devices") uses Google, and its request state is bound to the Google provider on the server. Legacy auth and record-era tables and indexes are retained for recovery; no v1 sign-in endpoints are deployed.

Convex Auth v2 currently lacks the old standalone email-code sign-in method, so the desktop offers Google only. An email-only legacy account without a linked Google identity needs a separately reviewed account migration; an email match does not prove ownership. Do not create a new cloud copy over that account's saved data. Local saves and recovery exports remain available.

The Convex developer CLI login is separate from Budget Terminal user sign-in. Other devices only need the application and the Google account.

## Desktop authentication and privacy

Signed-out users see an account popup on the front screen at launch. **Continue with Google** opens Google for the shared Budget Terminal deployment, in both sign-in and sign-up modes. The first successful sign-in creates the account. Sign-in persists by default: encrypted credentials are restored before the first renderer account check, so a signed-in user skips the popup. Browser approval closes it automatically. **Continue locally**, the close button or Escape dismisses it for this app session. **Don’t show again** saves a device-only preference across restarts; **Settings → Cloud sync → Show sign-in popup at startup** restores it. Sign-in remains available in Settings even with the popup disabled. All implemented pages continue preloading behind the popup. Account status is checked live and excluded from the persisted renderer market cache.

Authentication runs in Electron's main process behind `window.api`. OAuth state, one-time codes, access tokens and refresh tokens never enter the renderer, local MCP tools or browser response text. Sessions are encrypted with Electron safeStorage in `sync-session.bin`; a working OS keyring is required and plaintext storage is refused.

V2 requires an explicit redirect-origin allowlist. The desktop binds only `127.0.0.1`, trying ports 43871 through 43875, and uses a fresh random 256-bit callback path for each attempt. Only those five loopback origins are allowed by the backend. If all ports are occupied, sign-in fails safely. The listener validates the Host, path, method, parameter names and duplicate parameters, and closes after success, cancellation or five minutes. Provider cancellation and expiry return to Settings immediately.

Before opening the system browser, the app validates Google's HTTPS authorization host and path (`accounts.google.com/o/oauth2/v2/auth`), the deployment-specific Google callback, state and PKCE parameters; any other authorization URL, including GitHub's, is refused. Completion presents the one-time code with the initiating state to `completeSignInWithGoogle`, under the quota, purpose and grant policy below. The saved session records its provider; GitHub sessions are retired on restore as described above. V2 `refreshSession` rotates credentials serially and the replacement is encrypted before use. `noSession` clears the in-memory session, erases expired credentials and asks for sign-in. Disconnect stops local sync even if credential deletion fails, and independently attempts server revocation. Backend data reads resolve a live v2 session through the auth component, so a revoked session cannot access snapshots even if its access token has not expired.

Anonymous sign-in allows 30 starts per minute and at most 120 active requests. Authenticated session-management verification has separate reserved capacity (30 starts per minute, 40 active requests deployment-wide), with a further limit of three starts per minute and two active requests per authenticated user. Its account key comes from the live server session; caller-supplied IDs cannot create fresh buckets. Anonymous exhaustion therefore cannot consume the security-action allocation. These are aggregate/account resource limits, not per-IP fairness guarantees; trusted network-level abuse protection would require a gateway that cannot be bypassed through public mutations. Requests expire after five minutes. Request and grant hashes are stored instead of raw state or grant secrets. Expired rows and inactive quota records are removed in bounded batches by the five-minute cron. SDK initiation/redemption adapters are internal-only, so callers cannot bypass the public policy layer. Their typed handler adapter is checked at module initialization and by probes when upgrading the Convex SDK.

## Local saves, sync and recovery

Synced: portfolios and options, personal finance, custom cards, articles, charts watchlists and shared preferences. Browser profiles, cookies, provider keys, agent histories, market caches and device paths stay on the device.

Signing in with Google is the only consent sync needs. There is no separate workspace-ownership step: on 2026-11-27 it was removed because it left devices paused indefinitely after the move from GitHub to Google sign-in. The retired `sync-workspace-owner.json` record is deleted on the next sign-in.

The first sync between a device and an account (no checkpoint for that account yet) follows the new-device rules automatically:

- **Cloud copy holds saved records:** the device restores it. A complete local recovery backup is saved first, and Settings says so until the next upload or download.
- **Cloud copy holds no saved records, or there is none:** the device uploads its own data. A cloud copy counts as having no records when it has no positions, cash, options, finance entries, watchlists, articles or custom cards beyond the shipped starters. Preferences are ignored, so defaults written by another build, or with a changed preference, never replace saved local data.
- **This device holds only factory defaults:** it restores any cloud copy and never uploads its defaults to an empty cloud. Settings reports that the account has no cloud copy yet, and sync starts once you save data on this device or another signed-in device uploads.

Signing in to a different account, or changing the deployment, follows the same rules. Every restore keeps a local recovery backup.

After the first sync, devices compare against their last acknowledged checkpoint. Only edits made on two devices since they last synced need **Keep this device's copy** or **Use cloud copy**, followed by explicit confirmation. A selection must be confirmed again if either copy changes. Records from competing snapshots are not merged.

## Authentication state and sessions

Settings distinguishes restored offline credentials, authenticated connections, pending browser approval, expired/revoked sessions and an unavailable credential keyring. It displays the connected deployment and the verified Google address after a new sign-in. The address is refreshed on sign-in; unverified addresses and provider credentials are not added to the account response. Older sessions can show a generic account label until their next sign-in.

Credentials use Electron’s asynchronous safeStorage APIs. Existing synchronous encrypted files remain readable; key rotation re-encrypts the file atomically. Temporary keyring unavailability preserves credentials and offers **Retry saved sign-in** after unlocking. Tokens remain in the main process and are persisted before use. Malformed JWT expiry data triggers a refresh, never a local authentication verdict. HTTP and WebSocket refreshes are serialized and a queued force-refresh reuses a token another operation already refreshed. Lost responses and credential-write failures retain the previous refresh token for retry under Convex Auth v2’s rotation contract.

Access tokens last five minutes. Session maximum lifetime and refresh inactivity timeout are both explicitly 30 days. **Sign out other devices** starts an OAuth request bound to that purpose and the current live user/session. Only completion of that matching one-time flow issues a random action grant bound to the newly verified session. The grant expires in two minutes and is consumed atomically by revocation. Ordinary login and a recently issued access token cannot mint or replace the grant. The new session is encrypted before the grant is used, and only that user’s other sessions are revoked. A wrong-account verification revokes the newly created wrong-account session and leaves the existing account unchanged. Raw grants are kept only in main-process memory.

Disconnect clears the in-memory session first and writes a non-secret `sync-signout.json` marker. If deletion fails, the marker prevents credentials restoring after restart and Settings offers **Retry credential cleanup**. Server revocation is attempted even after a deletion failure. If both marker persistence and deletion fail, the UI explicitly warns that saved credentials may restore on restart. The marker retains server-revocation uncertainty across restarts; it contains no tokens. A new successful sign-in clears it. Offline failures are shown as unconfirmed server sign-out; no plaintext revocation queue is retained. Reconnect and verify **Sign out other devices** when online to revoke remaining sessions.

Cancellation and shutdown track in-flight OAuth redemption. Tokens returned after cancellation, or rejected because session persistence failed, are revoked instead of being silently discarded. Shutdown drains these cleanup tasks; failed server cleanup is reported as unconfirmed. Keyring failures, credential corruption, filesystem/permission failures and network outages have separate recovery states and messages. Signed-in devices can **Retry saving sign-in** without losing the previous encrypted session. A false WebSocket auth update is confirmed over authenticated HTTP before removing a saved session, so an offline socket cannot discard valid credentials.

Deploy the updated Convex functions and schema using `npm run convex:setup` for the selected development deployment, or `npm run convex:deploy` for production, before using the new account query and session controls. Desktop builds do not deploy the backend. The scripts retain the existing private recovery export requirement.

Local edits save without waiting for network requests. Durable edit timestamps and the last acknowledged checkpoint preserve pending work across restarts. Server revisions order changes independently of device clocks; accepted updates have strictly increasing server timestamps. An authenticated subscription and a 15-second background check detect changes and retry failures.

Downloads validate all stores, save a recovery backup, check for intervening local edits and journal the replacement. An interrupted replacement rolls back before the next window opens. Recovery copies live under the private application-data `sync-backups` directory. Disconnect keeps local data and the cloud copy. Complete snapshots have a 750 KB UTF-8 payload limit; larger libraries continue working locally and show a sync error.

## Snapshot validation and write allowances

`electron/shared/cloudSnapshot.ts` defines the network schema used by both Convex writes and desktop downloads. Validation rejects malformed JSON, unsupported versions, unknown fields, incorrect nested types, non-finite numbers, duplicate finance/card/article IDs, inconsistent portfolio IDs/references and oversized collections. It does not coerce values or apply local recovery defaults. The outer snapshot remains version 1; holdings-store versions 1/2 and card-store versions 1/2 remain supported, including older optional fields. Collection ceilings match the stores for portfolios (5) and each finance category (40), with 1,000 custom cards and 10,000 entries per other collection; general text is limited to 4,096 characters, IDs to 256, card names to 80, and article fields keep the store's existing limits. Local backup import and crash recovery bypass the cloud byte cap so larger libraries remain usable locally. Validation errors contain fixed codes/messages without payload values or schema diagnostics.

Each authenticated account may commit 60 changed snapshots per 60-second window and 100,000,000 UTF-8 payload bytes per 24-hour window, both starting at the account's first write in that window. `syncWriteLimits` is separate from the archived record-era tables. Allowance updates and snapshot replacement share one Convex mutation transaction. Unchanged-payload retries, stale-revision conflicts and invalid snapshots do not consume allowance. Limits return `SYNC_RATE_LIMITED` with a bounded retry duration. The desktop preserves pending work and defers further uploads until reset while continuing to inspect remote changes, download and resolve conflicts. Invalid/oversized snapshot errors remain separate and private in Settings.

The sync API uses generated schema-aware query/mutation builders, explicit return validators and generated API references in the Electron host. No new renderer commands, MCP tools or permissions are introduced. Deploy the current schema and functions with `npm run convex:setup` (selected development) or `npm run convex:deploy` (production) to activate server validation, reserved OAuth capacity and account write allowances. A desktop build or code generation alone does not deploy these policies.

## Verification

```sh
npm run typecheck
npm run probe:cloud-oauth
npm run probe:auth-ui
npm run probe:cloud-sync
npm run probe:convex-auth-live
# Interactive: approve two Google sign-ins in the system browser.
npm run probe:auth-acceptance
npm run probe:settings-ui --workspace budget-terminal-desktop
npm run build
npm run probe:mcp
npm run probe:launcher
```

Offline probes exercise the real callback listener, state-bound redemption, hostile requests, allowed-port fallback, cancellation, account linking, revoked-session isolation, snapshot conflicts and recovery. The host lifecycle probe covers automatic first sync after sign-in, switched accounts, retired ownership records, cloud restores, concurrent/lost refreshes, filesystem and keyring failures, deletion failure across restart, late-redemption cancellation/shutdown cleanup, malformed JWT recovery and key rotation. Backend policy probes check quotas, internal-only adapters, purpose/account/session binding, grant hashing/expiry/replay and bounded cleanup. The real Electron session probe verifies asynchronous encryption and legacy file restoration.

The live probe checks deployed capability versions, that no GitHub sign-in function is callable, the Google authorization entry, callback routing and rejection of unauthorized account/session/data access. It creates only an expiring OAuth request and does not modify saved user data. It fails against a deployment that has not received the GitHub removal yet. A completed live browser login, successful live token rotation and authenticated cross-device sync require a signed-in browser and are not claimed by that probe.

The opt-in `probe:auth-acceptance` opens two human-approved Google flows using the same account and separate temporary device credential files. Each stage runs in a new Electron process, verifies restoration and persisted rotation, reads the same live snapshot from both devices, and revokes only a temporary test session to prove immediate denial while the other stays authenticated. Finally it revokes both test sessions and removes its private temporary directory. It never writes cloud snapshots or signs out existing application sessions. It does not exercise the live bulk-revocation action against a personal account; grant enforcement is covered by policy probes and live unauthorized-access checks. If server cleanup cannot be confirmed, the encrypted temporary credentials are retained outside the repository for recovery. Do not share them.

Use `npm run probe:auth-acceptance -- --offline` to check the isolated runner and real encryption across process restarts without opening Google. To retry cleanup of an interrupted live run, pass its reported OS temporary directory to `npm run probe:auth-acceptance -- --cleanup-only "RECOVERY-DIRECTORY"`; both completed and temporary encrypted files are handled. Recovery paths are restricted to this probe’s OS temporary directories.

Deployment on 2026-11-14: the locally configured development backend was exported privately and upgraded to the `auth` and `authGithub` components. Existing GitHub variables and legacy records were retained. Production was not changed.

Account security update on 2026-11-14: the selected development deployment was exported privately before deploying account capability metadata, public-login projection, explicit session lifetimes and fresh-sign-in authorization for other-device revocation. Existing account ownership and cloud snapshots were retained. Production was not changed.

Lifecycle hardening on 2026-11-14: a second private development export preceded deployment of capability version 2, internal SDK adapters, purpose-bound single-use grants, OAuth initiation budgets and expiry cleanup. The updated live probe passed unauthorized-access and internal-adapter rejection checks. Offline probes passed the new lifecycle failures and the isolated acceptance runner’s real encryption/process-restart checks. Human-approved two-device acceptance is separate and is not claimed by these results. Production was not changed.

Live two-device acceptance on 2026-11-14: both system-browser GitHub sign-ins completed successfully against the development deployment. Separate Electron processes restored encrypted credentials, both temporary devices read the same cloud snapshot, token rotation was persisted, and revoking one temporary session immediately denied its snapshot access while the other remained authenticated. Cleanup confirmed revocation of both temporary test sessions and removed the private temporary directory. No cloud snapshots were written and existing application sessions were not revoked. This check does not claim live bulk revocation of existing devices.

Callback repair on 2026-11-14: the development GitHub OAuth App still registered only the exact v1 URI. The exact v2 URI was added alongside it with wildcard matching left disabled. A signed-in browser completed the real v2 flow; authenticated access found the existing cloud snapshot, token rotation preserved the user identity, and revoking the temporary test session immediately blocked snapshot access. No saved user data was changed and no credentials were saved by this check.

GitHub sign-in removal on 2026-11-25: the desktop, backend functions, setup script and probes became Google-only. The `authGithub` component and its account links were kept mounted. The Convex functions must be deployed with `npm run convex:setup` before the live probe passes.

References: [Convex Auth v2 setup](https://docs.convex.dev/auth/convex-auth/getting-started), [OAuth providers](https://docs.convex.dev/auth/convex-auth/methods/oauth), [v1 migration status](https://docs.convex.dev/auth/convex-auth/migrating/from-convex-auth-v1).

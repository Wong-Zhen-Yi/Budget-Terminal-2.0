# Optional account sync

Budget Terminal reads and saves its existing local files. Accounts and cloud access are optional. Startup still preloads every implemented page without waiting for cloud access. Sync controls, failures and diagnostics appear only in Settings; there is no global loading banner or bottom status strip.

## Release status

The repository implements protocol 2 record sync and offline acceptance probes. **A production service has not been configured or verified by this implementation run.** The local development deployment is not used as the public production service. No public user capacity, production latency or operating cost has been established. Keep `database.md` until its live acceptance requirements are complete.

`apps/desktop/config/cloud-sync.json` is public application configuration:

```json
{ "productionUrl": "", "developmentUrl": "" }
```

The service operator sets `productionUrl` to the production deployment's public HTTPS `.convex.cloud` address before distributing a release. An alternative is the build variable `BUDGET_TERMINAL_SYNC_PRODUCTION_URL`, including in an ignored `.env.production.local`. This address is public configuration, not a credential. Never put keys, tokens or signing material in this JSON file or in renderer variables.

Development uses `BUDGET_TERMINAL_SYNC_DEVELOPMENT_URL`, `developmentUrl`, or the existing local `VITE_CONVEX_URL`, in that order. Production builds never fall back to `VITE_CONVEX_URL`. `npm run build:release` refuses a release without production configuration. `npm run build` and the double-click launchers remain usable for local development and offline use; an unconfigured build explains that cloud sign-in is unavailable. Neither build command creates an installer.

## End-user flow

1. Install/open Budget Terminal. No account is needed for local use.
2. Open **Settings → Data & storage → Cloud sync**. Enter an email, request a code and verify it. Alternatively, select **Sign in with GitHub** and approve in the system browser.
3. Ordinary users never enter a deployment URL or use a developer CLI. **Advanced: custom sync server** is an explicit override for trusted custom deployments. That server receives the user's saved financial records.
4. A fresh device restores the account's cloud library automatically. Empty factory defaults never replace an existing cloud library.
5. If local work already exists, review before connecting. **Import this device’s data** combines the two libraries and chooses the device's versions where record IDs match. **Use cloud data from this account** restores the account's library, saving a complete local backup first. Choosing an empty account's cloud data restores factory defaults. Changed data invalidates an outstanding confirmation.

Disconnect removes local session credentials and attempts server sign-out. It retains local records, checkpoints, local backups and cloud data. Offline edits remain in local files. Reconnecting the same account resumes its acknowledged record baseline. Connecting a different account always reviews retained local data before uploading anything, including when that account is empty. This is account safety for public users, not a multiple-local-profile feature. Users sharing one OS account can still access that OS account's retained local files.

GitHub sign-in uses a temporary listener bound to `127.0.0.1`, a random port and callback path, and a Convex Auth verifier. It closes after a valid callback, cancellation or five-minute expiry. Tokens and verifiers remain in the Electron main process. Email codes expire after 15 minutes. Email verification stays bound to the server used to request the code even if Advanced is collapsed afterward.

## Record protocol and conflict policy

Implementation: `convex/sync.ts`, `electron/shared/syncRecords.ts`, `electron/services/cloudRecordEngine.ts`, `cloudSyncHost.ts` and `cloudSyncData.ts` under `apps/desktop`.

Cloud tables contain:

- `syncAccounts`: an authenticated user's epoch, monotonic sequence, migration offset, storage/rate counters and deletion fence.
- `syncRecords`: current versions of individual records, indexed by `(userId, key)` and `(userId, seq)`.
- `syncHistory`: previous versions retained for 30 days, with bounded cleanup every ten minutes. History has a separate storage quota.
- `syncSnapshots`: the unchanged pre-migration snapshot, retained for recovery until account deletion. New snapshot writes are rejected.
- `syncAuthLimits`: bounded email, session and service upload counters. Email recipients are hashed in these counters; authentication itself necessarily stores the sign-in email in Convex Auth's tables.

Logical keys are canonical JSON tuples containing kind and stable local IDs. Portfolios, holdings by ticker, option positions by row ID, finance cash/debt entries, bills, custom cards and articles are separate records. Ordering, selection, finance goals, chart watchlists, card intervals and each allowlisted settings field have explicit preference records. All previously synced fields are included. Unknown settings, forged owners, mismatched IDs and malformed fields are rejected by strict shared server validation.

Article text is split into immutable SHA-256-addressed chunks before publishing an article manifest. Updating the manifest is the atomic article edit, so two versions of an article cannot be spliced together. References resolve only inside the authenticated account. Content hashes are deduplicated within an account, never across accounts. An article can retain the local store's one-million-character limit without approaching Convex's per-document limit.

Every query, mutation, relationship check and migration derives the owner from authentication. Public functions accept no owner selector or database document ID. A guessed logical ID can identify only a record in the caller's own namespace. Account epochs cannot grant access to another account.

The durable local checkpoint contains the acknowledged baseline, received records, a change cursor, pending writes and competing versions. Local saves and normal backups do not wait for sync. Before network writes, exact pending changes are persisted. Identical retries return the existing revision without creating extra history or duplicate financial entries. Successful partial batches are checkpointed separately. A failed response can be retried after restarting.

Changes use a per-account increasing sequence over current record versions. Reads return at most eight records; writes contain at most sixteen records and 240,000 bytes, with at most one article manifest so referenced content reads are also bounded. The desktop subscribes only to the small account signal. A fifteen-second background check catches local edits and retries failures. Transfers contain changed records rather than whole libraries.

The cursor and cached records persist atomically after each page. Record updates move to a newer sequence, so concurrent changes remain discoverable. Deletion markers are permanent; cursors do not expire with time. An epoch change or cursor beyond the server's sequence archives the previous checkpoint and requires review during a bounded full resync. Local files and archived offline edits are preserved; a restored older backend cannot silently replace the device library.

Edits to different records merge automatically. Different edits to the same record preserve the local version and received cloud version and require a choice in Settings. Independent records continue syncing. The confirmation is tied to both versions; if either changes, the choice must be made again. An offline edit competing with a deletion also requires review. Deleting a portfolio competes with offline edits to its holdings/options/tickers; the portfolio choice explicitly covers its children. Both complete libraries are archived locally before resolving such a conflict. Backend history also retains overwritten versions within its retention/quota limits.

Downloads compare the current local payload with the payload captured before network work. They cannot overwrite intervening local edits. Before applying a download, all stores are validated, a complete private recovery backup is saved, and a replacement journal is written. Cloud replacements must round-trip exactly through the local stores; any normalization that would drop/change a field rolls back rather than silently discarding work. An interrupted replacement restores its previous local state before the next application window opens.

## Migration and recovery

Deploy protocol 2 to the backend and update desktop clients together. The old `sync:write` endpoint rejects every snapshot write with an upgrade requirement, even before that account's migration starts. Old clients can read their archived snapshot but must upgrade to participate in sync. Do not re-enable snapshot writes after migration.

On first connection, `prepare` creates an account epoch and migration state. If a snapshot exists, `migrate` validates and deterministically splits it, then writes bounded batches and advances an atomic offset. The original snapshot is never modified. Migration can resume from any completed offset after disconnection or a failed response. The completion marker is set only after every record has been written. Ordinary record writes wait for completion.

When converting a legacy local checkpoint, the app backs up both that checkpoint and the current local library first. It converts the acknowledged snapshot into a record baseline, preserving later unsynced local edits. Oversized or invalid legacy fields fail visibly and preserve the source; operators should repair a private exported copy instead of resetting the account.

Recovery files live in the existing private `BudgetTerminalElectron/sync-backups` directory under APPDATA. `before-sync-*.json` and `before-record-migration-*.json` contain complete libraries and can be restored through **Import User Data**. A review archive contains `localSnapshot` (a JSON string) plus `cloudRecords`, or the initial `local`/`cloud` copies; an operator can privately extract the chosen snapshot or reconstruct records with `joinSnapshot`. Keep the original archive. Never commit recovery files.

For migration recovery, first export the original `syncSnapshots` row and existing records with the authenticated account or operator dashboard. Preserve `migrationOffset` and epoch. Retry the idempotent migration. If validation fails, use a separate private staging deployment to repair/verify the archived library; export a normal backup and explicitly import it after recovery. Do not delete production data as a troubleshooting step. A database restore must preserve/reapply account deletion fences before enabling traffic, rotate the restored account epochs, and require client review.

## Export, deletion and retention

**Export cloud data** downloads a private JSON file containing the current cloud library, all current records including deletion markers and retained chunks, the account's stored name/email, the archived legacy snapshot when present, and storage counters. The normal library fields can be restored through **Import User Data**. It excludes session/refresh tokens, provider credentials and signing keys. Export verifies the account sequence before and after the paged read and refuses a library that changed during export. Retry after other devices finish syncing. The scope is current account data and its preserved legacy snapshot; revision history remains an operator recovery facility.

**Delete cloud account** requires typing `DELETE MY ACCOUNT`. The mutation first writes a permanent deletion fence. Every connected device, including an old snapshot client, is immediately prevented from reading/writing that account. Scheduled bounded jobs then remove cloud records, chunks, history, snapshots, refresh tokens, sessions, related verification codes, linked authentication accounts and the user profile. Jobs are idempotent and resumable. A minimal opaque owner/deletion fence remains to prevent an old token or device from recreating the account's data.

Local files, local checkpoints, review archives, local automatic backups and previously exported files are retained until the user removes them. Disconnecting is not deletion. Recreating an account after deletion creates a new identity; a device with old local files must explicitly review an import. Account deletion does not authorize silent re-upload.

Current live records, deletion markers, unused immutable article chunks and the archived legacy snapshot remain until account deletion. Deletion markers and chunks have no automatic garbage collection, which preserves indefinitely offline devices; they count toward account quotas. Previous record versions expire after 30 days, with cleanup in batches of 100. Operators must monitor cleanup lag and retained history size. A history quota refuses further changes safely rather than silently deleting financial history. Local review archives are retained without automatic cleanup.

The operator must publish the actual deployment backup retention, deletion recovery window, regional storage location and privacy/support contact before public launch. Those policies were not configured here. Deleted contents may remain in operator/platform backups until the configured retention expires. Operators must retain and reapply deletion fences during any restore. Data is **not end-to-end encrypted**. The service operator can access server-side user records.

Excluded from the payload: browser profiles/cookies/session data, provider API keys, agent conversations/images, market caches, renderer-only ephemeral state, device paths and backup timestamps. Electron safeStorage encrypts the local session file and requires a usable OS keyring; there is no plaintext credential fallback. Recovery/checkpoint files contain private financial data and rely on OS file permissions. Git ignores these runtime files and cloud exports; repository privacy hooks also reject force-staged copies under recognized names.

## Operator deployment and email setup

Only the operator performs these steps. Users of a distributed build do not create Convex projects.

1. Create/select the service's Convex project and separate development and production deployments. From `apps/desktop`, run `npx convex dev --once` for development setup. Back up existing production data before changing its schema. Do not run the generic Auth scaffolder over the implemented auth files.
2. Provision signing material separately per deployment: run `node scripts/create-convex-auth-keys.mjs`, then upload the ignored file with `npx convex env set --prod --from-file .env.convex-auth.local`. For development omit `--prod`. The script refuses to overwrite an existing local file and never prints key bytes. Remove the local file after uploading it. Never publish it.
3. In the production deployment's private dashboard environment settings, configure `JWT_PRIVATE_KEY` and `JWKS` from that file, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, and `SITE_URL`. Set `SITE_URL` to the exact HTTPS `.convex.site` URL and `AUTH_LOG_LEVEL` to `ERROR`; never enable Auth debug logging in production because it includes authentication arguments. `CONVEX_SITE_URL` is supplied by Convex. Configure an independent set for development. Do not put credentials in shell arguments or public build variables.
4. Register a production GitHub OAuth App with callback `https://YOUR-DEPLOYMENT.convex.site/api/auth/callback/github`, retaining any regional hostname segment. Use a separate OAuth App for development. Set the Client ID/Secret only on that backend. A public boolean setup check prevents opening an unconfigured GitHub flow.
5. Verify a sending domain in Resend, configure DNS authentication, and set its verified sender as `AUTH_EMAIL_FROM`. Configure delivery monitoring, bounces and provider spending alerts. Email delivery must be tested to actual controlled test inboxes; mocked callbacks cannot verify it.
6. Deploy with `npx convex deploy`. Convex regenerates its API/types. Confirm the indexes, scheduled cleanup job and deletion jobs work. Copy only the public production URL to `config/cloud-sync.json` or `BUDGET_TERMINAL_SYNC_PRODUCTION_URL`. Run `npm run build:release` from the repository root.
7. Perform the live release checks below with controlled test accounts/devices. Publish the privacy/retention/support policy and set service budget alerts before distributing a production build.

PowerShell may require `npx.cmd` and `npm.cmd`. Regional `.convex.cloud` endpoints are supported; copy the exact deployment address. Production signing keys, mail keys, OAuth secrets, deployment/admin keys and developer login credentials must never enter desktop configuration, renderer payloads, screenshots or the public repository.

## Quotas and operations

The application enforces conservative service limits rather than claiming a supported user count:

| Limit | Value |
| --- | --- |
| Record JSON body | 64,000 UTF-8 bytes |
| Mutation batch | 16 records / 240,000 serialized bytes |
| Read page | 8 records |
| Current record data per account | 50,000,000 bytes |
| Records per account, including chunks/tombstones | 20,000 |
| Local domain limits also enforced in cloud | 5 portfolios; 40 rows each for cash, debt and bills; at least one portfolio retained |
| Account writes | 600 records in accepted/conflict batches per minute |
| Account accepted uploads | 100,000,000 bytes per day |
| Retained history per account | 100,000,000 bytes |
| Service uploads/migration circuit breaker | 1,000,000,000 serialized bytes per day |
| Email deliveries requested | 5 per recipient/hour, 100 deployment-wide/hour |
| Failed sign-in attempts | Convex Auth: 10/hour per identifier |
| New authenticated sessions | 30/account/hour |

Quotas reject writes without changing local files. Write/migration limits are transactional; rejected malformed batches roll back their transactional counters and still need platform request protection. Email budgets use committed internal counters before mail delivery, including failed provider sends. Authentication rate limiting does not replace platform abuse protection, bot controls or provider budgets: enable the deployment's available edge protections and monitor unauthenticated request volume. Read/export traffic is bounded per request but still consumes service resources; protect and measure it at the deployment level. These defaults need a measured review before increasing them.

Settings includes session sync attempts, failures, duration and record/body-byte counters. Local diagnostics log only fixed sync outcome labels and numeric counters; no financial fields, IDs, emails, payloads, tokens or raw errors. Payload counters exclude protocol/WebSocket overhead and failed transfers. Use the Convex dashboard to monitor function failures and p50/p95 latency, database/index/history growth, bandwidth and scheduled-job failures. Monitor Resend delivery/failures and charges separately. Configure provider/team billing alerts and a service budget; alerts were not created by this code change.

For representative live load measurement, record the deployment region/plan and client count, library/record counts, edit/reconnect rates, p50/p95 sync latency, mutation/query failure rate, database/index growth, actual network bandwidth, email volume, cleanup lag and billed usage. Test large restores, many small edits, long-offline reconnects, conflicts, export and deletion. Convert measured metered usage to current provider prices and record the date and uncertainty. Do not infer capacity or costs from the mock probe or a document-size limit.

## Validation and outstanding live acceptance

Run from the root:

```sh
npm run typecheck
npm run build
npm run probe:cloud-sync
npm run probe:cloud-oauth
npm run probe:settings-ui --workspace budget-terminal-desktop
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:launcher
npm run probe:agent-privacy
```

Persistence probes redirect both APPDATA and LOCALAPPDATA to temporary directories. Protocol probes use `convex-test` with transaction limits enabled and exercise the actual registered server functions/validators and client engine. They cover forged owners/guessed IDs/cross-account references, offline/restart/lost-response convergence, stable financial IDs, independent/competing edits, stale confirmations, permanent deletions, account switching/deletion, preserved/resumable migration, old-client gating, record/batch/rate/email limits, export metadata and Unicode article reconstruction. The UI smoke test exercises public configuration, email/GitHub flows, review/confirmation controls, cancellation, custom servers, and narrow layouts. Local-store probes retain import/backup/journal rollback checks.

A synthetic library of 3,572,946 UTF-8 bytes round-tripped in the in-memory backend through bounded batches/pages (roughly 4–8 seconds on this development machine; timings vary). This demonstrates protocol handling above the old package cap, not production performance, availability, supported users or cost. Realistic smaller archived libraries exercise interrupted migration/retry and unchanged source snapshots.

Still required before public release: configure/verify the production endpoint, keys, OAuth and mail sender; test actual email delivery, GitHub callbacks, two controlled accounts and two installed devices; verify deployed quotas and deletion/cleanup jobs; measure representative live load and actual costs; configure billing alerts, edge abuse protection, platform backups and the published retention/privacy/support policy. Confirm production builds contain the intended public URL and no development configuration or credentials. Keep `database.md` until these checks pass and are recorded honestly.

Verification on 2026-11-09: typecheck, build, cloud sync/migration/abuse probes, OAuth callback probe, Settings UI smoke, startup loading, launcher and repository privacy probes passed. Convex modules also bundled for the browser runtime without Node-only imports, and the production desktop bundle excluded the local development endpoint. A high-confidence token/private-key/personal-email pattern scan of 886 public source files found no matches; this is a scoped scan, not a guarantee against every kind of secret. `build:release` correctly refused the unconfigured production endpoint. No production sign-in/email, live load, cost, billing-alert or backup-retention checks were marked passed.

References rechecked during implementation: [Convex authentication](https://docs.convex.dev/auth/overview), [current limits](https://docs.convex.dev/production/state/limits) (1 MiB per document), [Auth manual setup](https://labs.convex.dev/auth/setup/manual), [Auth API/configuration](https://labs.convex.dev/auth/api_reference/server), [convex-test](https://docs.convex.dev/testing/convex-test), [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction). Recheck limits, provider pricing and beta Auth behavior at deployment time.

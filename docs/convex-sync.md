# Optional Convex sync

Budget Terminal always reads and writes its existing local JSON stores. Convex is an optional remote copy. No account, deployment URL or internet connection is required to use the app. Disabling or disconnecting sync keeps local data intact. Startup page preloading does not wait for Convex.

## Deploy your backend once

Use a private Convex project shared by your devices. Run the following from `apps/desktop` (PowerShell users may need `npx.cmd` and `npm.cmd`):

```sh
npx convex dev --once
node scripts/create-convex-auth-keys.mjs
npx convex env set --from-file .env.convex-auth.local
```

The first command signs into Convex, selects/creates your project, generates types and deploys `convex/`. The keys script creates a private ignored local file and refuses to overwrite an existing one. After successfully uploading the keys, remove `.env.convex-auth.local` with your file manager. These signing keys belong only on the backend; never put them in the desktop configuration.

In the **same Convex deployment's dashboard environment variables**, configure:

| Variable | Value |
| --- | --- |
| `AUTH_GITHUB_ID` | The Client ID of your Budget Terminal GitHub OAuth App |
| `AUTH_GITHUB_SECRET` | The Client Secret of that GitHub OAuth App |
| `SITE_URL` | The deployment's HTTPS site URL, ending in `.convex.site` |

Register a **GitHub OAuth App** at GitHub → Settings → Developer settings → OAuth Apps. Use your `.convex.site` URL as the homepage, and `https://YOUR-DEPLOYMENT.convex.site/api/auth/callback/github` as the authorization callback URL. Configure its Client ID and Client Secret only in the Convex dashboard; the secret never goes into the repository or desktop app. GitHub redirects to Convex first, so the registered callback is the backend URL rather than a desktop port.

`CONVEX_SITE_URL` is provided by Convex. `JWT_PRIVATE_KEY` and `JWKS` were installed by the commands above. For the optional **Use email code instead** method, also configure `AUTH_RESEND_KEY` (a Resend delivery key) and `AUTH_EMAIL_FROM` (a verified sender address) on the backend. Email codes expire after 15 minutes. GitHub sign-in does not require Resend or an email sender.

For a production deployment, run `npx convex deploy`, repeat key generation/upload with `npx convex env set --prod --from-file .env.convex-auth.local`, and configure the GitHub variables in the production dashboard. Register a separate GitHub OAuth App for that production deployment's callback URL. Dev and production environments have separate data, keys and settings. Do not run the generic Convex Auth scaffolder over this repository: the auth files are already implemented.

## Connect each device

1. Open **Settings → Data & storage → Cloud sync · Convex**.
2. Enter the deployment URL ending in `.convex.cloud` and click **Sign in with GitHub**. Regional URLs such as `https://YOUR-DEPLOYMENT.ap-southeast-2.convex.cloud` are supported; copy the exact URL from your dashboard.
3. Approve in your system browser. The response returns automatically to the desktop app; Settings updates when sign-in completes. Close the browser tab when finished.
4. Repeat with the same deployment and GitHub account on other devices. Use **Cancel sign-in** to stop a pending request; pending requests expire after five minutes.

This signs into Budget Terminal's own user-data backend. Signing into the Convex dashboard through GitHub, or authorizing the Convex developer CLI, is a separate developer action and does not sign into the app. No CLI login or Convex administrator credential is needed on other devices.

The desktop creates a temporary listener bound only to `127.0.0.1`, using a random port and a random callback path. The backend allows only that constrained return URL. A Convex Auth verifier binds the exchanged code to the device that started sign-in; codes, verifiers and session tokens are kept out of the renderer. The listener closes after one valid callback, cancellation or expiry. Browser/OS policy must permit a loopback return to the desktop. Local use remains available if sign-in is cancelled or fails.

The first device uploads its local copy if the cloud is empty. A fresh device with only factory defaults automatically downloads the latest cloud snapshot after signing into the same account. It does not upload freshly generated empty stores over your saved work. An existing device with unsynced work still requires an explicit choice when both copies differ: **Keep this device's copy** or **Use cloud copy**. Confirming replaces the complete selected snapshot, including preferences; records from competing copies are not automatically merged.

## Offline operation and conflicts

- Local edits save through the normal stores and backups. They do not wait for a network request.
- Each local data change records a durable edit timestamp, including while disconnected. Reading data, retrying sync or exporting a backup does not change that timestamp. Factory defaults have no edit timestamp and are distinguished from existing work. Returning user data to its defaults does not erase its edit history.
- Each accepted cloud snapshot has a strictly increasing server `updatedAt` timestamp and a revision. Queries return both, and checkpoints preserve them across restarts. Settings shows the local data time, cloud data time and revision separately from the last successful sync. Retry of an already stored payload does not falsely make it newer.
- Ordering uses the server revision rather than comparing clocks on different devices. An older server revision cannot replace a newer acknowledged copy. Conflicting offline edits are preserved even if one machine's clock is wrong.
- Sync compares the on-disk data to the last acknowledged snapshot. This is the durable pending queue: offline edits survive app restarts without relying on Convex's in-memory mutation queue.
- An authenticated live subscription wakes sync when the remote copy changes. A 15-second background check also detects local edits and retries failures while the app is running.
- Convex mutations atomically compare revisions. If both devices edited since their shared baseline, neither copy is silently overwritten. Settings shows the conflict and requires an explicit selection. If either copy changes again while selecting, the selection must be confirmed again.
- A download checks that local data has not changed since the network read. It validates the stores, writes a complete local recovery backup, journals the replacement and updates the existing stores through the save queue. An interrupted replacement is rolled back from the journal before the next window opens.
- Recovery copies are in `BudgetTerminalElectron/sync-backups` inside the app's existing APPDATA directory. They contain sensitive user data; keep them private. Restore a recovery copy through the normal **Import User Data** control in Settings.
- Sync state, failures, pending changes and retry controls are confined to Settings. There are no global readiness/status banners.

## Scope and limits

Synced: portfolios and options, personal finance, custom cards, articles, and preferences in the settings store. Device-only browser profiles, cookies, provider keys, agent histories, market caches, renderer-only page state and backup timestamps are excluded. Device paths are excluded from the payload.

This initial implementation uses one versioned snapshot per account with a **750 KB UTF-8 payload limit** to stay within Convex's document limit. Larger libraries keep working locally, but sync reports an error until the payload is reduced. It uses complete-copy conflict resolution rather than automatic record merging. The Convex backend enforces the signed-in account on every snapshot query and mutation; clients cannot select another owner.

Session and refresh tokens are encrypted with Electron safeStorage in `sync-session.bin`. Sync requires a working OS keyring and refuses plaintext storage. The local checkpoint contains a copy of user data and is excluded from Git, as are local timestamp metadata (`sync-local-metadata.json`), sessions, journals, recovery backups and `.env` files. The deployment URL is public configuration; deploy/admin keys and provider secrets must never enter the renderer, repository or desktop bundle.

Cloud sync is implemented but a live end-to-end check requires your deployed Convex project and configured GitHub OAuth App. The offline probes use an actual local callback listener with mocked provider responses; they do not contact GitHub/Convex or send mail.

References: [Convex Auth manual setup](https://labs.convex.dev/auth/setup/manual), [GitHub authentication](https://labs.convex.dev/auth/config/oauth/github), [email authentication](https://labs.convex.dev/auth/config/otps), [Convex JavaScript clients](https://docs.convex.dev/client/javascript).

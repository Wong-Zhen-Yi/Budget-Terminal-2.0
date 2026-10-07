# Personal Supabase sync

Open **Settings → Data → Personal Cloud Sync**. Create an account using your email
and a password of at least eight characters, confirm the email, and sign in. Repeat
sign-in with the same account on each PC. The first signed-in PC seeds an empty
cloud account. Existing differing data on another PC requires choosing which copy
to keep; downloading writes a local rollback backup first.

Only portfolios (including saved option contracts), personal finance, and strategy
cards are uploaded to the connected Supabase project. Card order, visibility and
intervals travel with your cards. Prices, charts, provider responses, API keys,
general app settings, active-tab selections and local paths remain on the PC.

Edits save locally immediately. Differences from the last server-acknowledged
copy form a durable offline queue. Sync runs after saved edits, on app startup,
window focus, resume, reconnect, and every 30 seconds. Transient failures back off
up to five minutes. Settings shows pending datasets, failures, conflicts, and the
last successful sync. The app continues loading every implemented page at startup.

Conflicts are resolved for a whole dataset: **Keep this PC’s copy** uploads its
current saved records, and **Use cloud copy** downloads the displayed cloud records.
Changes to either copy after the comparison invalidate the choice until reviewed
again. Deletions and Clear All User Data also sync, so clearing one PC clears the
shared records when its changes sync. Sign-out leaves the local copy intact and
stops uploading; the persisted checkpoint binds it to the original account.

Email confirmation links work with Supabase’s standard email template. To expose
the optional in-app confirmation-code flow, include `{{ .Token }}` in the project's
Confirm signup email template. Passwords are never saved. Auth sessions are encrypted
with Electron's operating-system credential storage and excluded from app exports.
Secure storage must be available before sign-in. Backups continue to be local.

The checked-in migration creates `budget_terminal_sync` and the atomic
`budget_terminal_sync_write` RPC. Signed-out callers have no access. Account-owned
reads use RLS; the RPC checks `auth.uid()` and a server revision on every write and
does not accept an account ID from the client. Direct table writes are revoked.
The Supabase security advisor reports the
[intentional SECURITY DEFINER RPC](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable):
authenticated callers need this narrowly scoped function to perform revision-checked
writes without direct table-write privileges. Its search path is empty, it uses
qualified table names, and account isolation is covered by the SQL tests.

Validation:

- `npm run typecheck` and `npm run build`
- `npm run probe:sync` — offline recovery, revisions, conflicts, strict projections,
  serialized downloads, backups, and clear; uses temporary persistence directories.
- `npm run probe:sync-ui` — Electron fixture for sign-in, pending status, conflict
  review, choices, errors and sign-out; run build first. Screenshot: `apps/desktop/out/sync-smoke.png`.
- `npm run probe:sync-service` — actual Supabase SDK with fixture responses inside
  Electron; verifies OS-encrypted sessions, backup exclusion, offline delivery,
  offline sign-out, and prevention of cross-account uploads.
- Run `supabase/tests/personal_sync.sql` in a transaction against the migrated
  project; it impersonates test accounts and rolls all fixture users/data back.

Real two-PC acceptance: sign in on this PC first, then on a second PC; verify a
portfolio edit, finance edit and card edit arrive in both directions. Disconnect
one PC, edit and restart it, then reconnect and verify delivery. Edit the same
dataset on both while disconnected and check that the conflict choice is required.
No real account credentials or personal records are uploaded by the automated probes.

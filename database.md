# Public-user database and cloud sync implementation brief

Status: protocol 2 is implemented, deployed to the separate production service, and offline verification passes. Production signing/discovery and the public release endpoint are configured. Production GitHub credentials and final release acceptance remain pending. See docs/production-release.md and docs/convex-sync.md. Do not delete this brief until the live production, isolation and operating-cost checks are complete.

User override, 2026-11-10: use GitHub only through Convex Auth, keep the existing account, and do not use a mail API. This supersedes the email-code/delivery requirements below. The existing saved-data deployment was backed up and updated; local launchers retain its configured address. The separate production backend and signing settings are now deployed; its independent GitHub OAuth credentials are pending.

## Instruction for the future implementation run

Implement this brief in the repository, following AGENTS.md. Inspect the current implementation first because it may have changed. Preserve unrelated working-tree edits. Complete the work and verification; document any external configuration that remains necessary. Delete this file only after the implementation and acceptance checks below are complete. Move lasting setup and architecture documentation into docs/convex-sync.md before deleting it. Remove temporary launcher comments referencing this file at the same time.

## Goal

Make Budget Terminal suitable for distribution to public users, each with their own account and devices. This is not a request for multiple local profiles on one PC. Users should install the app, optionally sign in, and sync without knowing what Convex is or setting up infrastructure.

## Existing foundation

- Local files remain the source for application reads and saves. Cloud sync is optional.
- convex/schema.ts defines auth tables and syncSnapshots, with one complete saved package per account.
- convex/sync.ts derives ownership from the authenticated account and looks up snapshots by userId. The foundation already supports separate accounts; do not claim it is limited to one user.
- Settings currently requires a deployment URL and offers GitHub sign-in or an email code.
- Each package has a revision and updated time, with a 750,000-byte payload limit. Sync replaces whole packages and requires a choice when both copies changed.
- Relevant files live under apps/desktop: convex/, electron/services/cloudSync*.ts, electron/shared/cloudSync.ts and src/components/settings/CloudSyncPanel.tsx.
- The existing code alone does not establish production readiness or proven capacity. Verify deployed behaviour separately.

## Required end-user experience

1. Ship the public production deployment address as application configuration. Ordinary users must not enter a URL, create a Convex project, use a CLI or supply developer credentials. Keep development and production configuration separate. If a custom backend option is retained, place it behind an explicit advanced setting.
2. Provide a simple account entry point such as “Sign in to sync your data”. Make email-code sign-in accessible to nontechnical users; retain GitHub as another supported option. Avoid changing authentication providers unless the requirements justify it.
3. Configure production authentication and email delivery on the backend. Document the operator setup. Never bundle signing keys, mail credentials, provider secrets or administrator keys. A public deployment URL is configuration, not a secret.
4. Keep offline local use available without creating an account. Signing in on a fresh device restores the account's data. Show useful connection, retry and conflict controls in Settings using plain language.
5. Define first-sign-in behaviour when local data already exists. Offer a reviewable import or merge decision where necessary; never silently replace existing work or upload empty defaults over saved cloud data.
6. Handle account switching safely: one person's local records must never be uploaded into another person's account by accident. Define how local data is retained or isolated on sign-out and account changes. Explain the choice to the user before any replacement.

## Replace whole-package syncing with record syncing

- Design separate cloud records for the actual saved domains, including portfolios, holdings/options, personal-finance records, cards, articles and preferences. Inspect existing models to determine the correct boundaries; preserve every currently synced field, including watchlists if present.
- Give synced records stable identifiers, authenticated ownership, revisions and appropriate indexes. Enforce ownership in every query, write, delete, relationship lookup and migration; never trust a client-supplied owner.
- Validate record contents and enforce sensible field and batch sizes on the server. A valid top-level package shape is insufficient validation for public writes.
- Sync only changed records. Page large reads and bound write batches. Do not substitute another unbounded per-user document for the current snapshot. The current Convex document limit must be rechecked during implementation.
- Persist pending changes locally so offline edits survive crashes and restarts. Make retries safe against duplicate transactions or records. Preserve local saves and backups even if cloud operations fail.
- Merge independent record edits automatically. If two devices change the same record, preserve both versions until a defined safe resolution is chosen; do not silently discard financial edits.
- Represent deletions so offline devices cannot resurrect deleted records. Define retention and safe cleanup for deletion markers and change history.
- Use a durable change cursor or equivalent protocol so devices can catch up, including after a long absence. Handle expired cursors with a safe full resync. Subscribe to small change signals rather than repeatedly transferring complete libraries.
- Keep local application stores and window.api boundaries intact. Preserve all-page startup preloading without waiting for cloud access.

## Migration and recovery

- Back up existing local data and preserve existing cloud snapshots before migration.
- Migrate each account's old snapshot to records with stable identifiers. Migration must be resumable and safe to retry, with a completion marker only after all records are safely written.
- Plan for old released clients that still write snapshots. Use version gating, compatibility handling or another explicit strategy so they cannot overwrite migrated data or create two divergent sources of truth.
- Test migration with realistic saved libraries, empty accounts and interrupted operations. Provide a documented recovery path without destructive resets.

## Public-service operation

- Add account export and account deletion with clear scope and confirmation. Distinguish disconnecting sync from deleting cloud data. Prevent a previously connected device from silently re-uploading deleted account data.
- Apply server-side abuse protection and quotas to sign-in/email requests and data writes. Limit individual record sizes, bulk uploads and excessive requests with understandable errors.
- Monitor sync failures, latency, database/storage growth, bandwidth and cost without logging financial contents or credentials. Establish budget alerts and measure representative usage before claiming a supported user count.
- Keep browser sessions/cookies, provider keys, agent histories, market caches and device paths out of synced data. Audit both the payload and public repository for accidental secrets or personal information.
- Document what is stored remotely, retention, backups and deletion behaviour. Do not describe the service as end-to-end encrypted unless that is separately implemented and verified.
- Preserve the locked colour scheme. Do not add global loading/diagnostic banners, readiness text in page labels or the bottom status strip. Detailed diagnostics belong in Settings.
- Update all double-click launchers as required by AGENTS.md. Exclude generated bundles, credentials and personal data from commits.

## Acceptance checks

- [ ] A new user can install, sign in and sync without a deployment URL or developer tools.
- [ ] Two distinct test accounts cannot read, edit or delete each other's records, even with guessed record IDs, forged owner fields or cross-account references.
- [ ] Two devices on the same account converge after normal edits, offline edits, retries, restarts and reconnects without losing or duplicating records.
- [ ] Independent edits merge; competing edits to the same record follow the documented conflict policy.
- [ ] Deletions remain deleted when a long-offline device reconnects.
- [ ] Account switching, disconnect, export and deletion cannot leak or accidentally re-upload another account's data.
- [ ] Existing snapshots migrate safely, including interruption/retry and older-client behaviour.
- [ ] A library larger than the old 750 KB package limit syncs through bounded records and batches.
- [ ] Local saves, recovery backups and every implemented page's startup loading still work offline.
- [ ] Sign-in and write abuse limits are exercised; representative load measurements and operating costs are recorded without unsupported scale claims.
- [ ] Run typecheck, build, relevant sync/auth/migration probes and a UI smoke test. Persistence probes use temporary APPDATA and LOCALAPPDATA. Inspect package.json for actual commands.
- [ ] Verify production sign-in, email delivery and two-account/two-device isolation against an appropriately configured deployment. Mocked offline probes alone do not satisfy live checks. Record external blockers honestly rather than marking them passed.
- [ ] Update durable documentation and launchers, then delete database.md only when all required work and checks are complete.

## References to recheck during implementation

- https://docs.convex.dev/auth/overview
- https://docs.convex.dev/production/state/limits
- Repository: docs/convex-sync.md

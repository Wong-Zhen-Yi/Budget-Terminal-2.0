# Production release configuration

Configured on 2026-11-10. The backend is deployed; production GitHub OAuth credentials are still required before the release build can complete.

| Setting | Public value / status |
| --- | --- |
| Production backend | `https://wonderful-otter-684.ap-southeast-2.convex.cloud` |
| Authentication site | `https://wonderful-otter-684.ap-southeast-2.convex.site` |
| GitHub OAuth callback | `https://wonderful-otter-684.ap-southeast-2.convex.site/api/auth/callback/github` |
| Backend protocol | 2, deployed and queried successfully |
| Signing/discovery | Independent RSA keys installed; public discovery/JWKS respond successfully |
| Auth logging | `ERROR` |
| GitHub OAuth Client ID / Client Secret | Pending; backend settings only |
| Existing development account/library | Preserved; local launchers keep their existing endpoint |

The production deployment was exported to a private operator backup outside the repository before configuration. No development accounts, financial records, browser sessions or keys were copied into production. The public URL is stored in `apps/desktop/config/cloud-sync.json`; private signing material is stored only in the production backend. Temporary provisioning files were removed. A stray variable created during the first Windows command invocation was removed and the intended names were verified.

## Complete OAuth setup

Register a separate GitHub OAuth App for this production callback, using a service-owned GitHub account or organization. Keep the existing development OAuth App unchanged. Install the new Client ID and Client Secret as `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` on the **production** Convex deployment, through secure input or the private deployment environment settings. Never put either value in source, build variables or renderer configuration. The signing settings `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` and `AUTH_LOG_LEVEL` are already installed; do not regenerate them to complete OAuth setup.

Then run:

```text
npm run check:production
npm run probe:cloud-signin-live -- https://wonderful-otter-684.ap-southeast-2.convex.cloud
npm run build:release
```

The live sign-in probe checks the backend and GitHub authorization redirect and cancels its temporary callback listener. It does not approve a GitHub login or read a user's saved records. Complete a real production sign-in and the account/device acceptance checks in `docs/convex-sync.md` before distribution.

## Build and validation

`npm run build:release` performs the production preflight and sets the production URL explicitly for the child build. It rejects a missing endpoint, incompatible backend, missing GitHub configuration, enabled email provider, mismatched issuer/JWKS location, invalid/weak public RSA keys or accidentally published private key material. Network/provider failures are reported without copying raw responses into logs. `npm run build:local` preserves the existing source-install account and does not require production availability.

`npm run probe:release` runs isolated tests for that gate and the signing-key generator. The generator emits a valid dotenv file, refuses to overwrite existing material, and its public/private RSA pair is verified with a synthetic signature. No real credentials are printed or stored by the probe.

Configuration-run verification passed: typecheck, the release probe, launcher probe, cloud configuration/sync/OAuth probes and repository privacy checks. A production-target candidate bundle also compiled, and a scan of its 30 JavaScript/HTML/CSS assets found the configured production endpoint, no development endpoint, and no high-confidence private-key/GitHub-token pattern. This scoped scan is not a guarantee against every credential format. The production backend's RSA public/private pair was checked with an in-memory signature; private material was neither printed nor published. `build:release` correctly remains blocked on the missing production GitHub configuration.

Application bundles are written to `apps/desktop/out/`. This repository does not currently package/sign installers, configure auto-updates or publish GitHub releases. Do not describe a successful bundle build as a signed installer or public release.

Public rollout acceptance remains separate: controlled production sign-in, two accounts/devices, deployed quota and cleanup/deletion checks, representative load/cost measurement, platform backups/budget alerts and the published privacy/retention/support policy. Keep `database.md` until those requirements are verified.

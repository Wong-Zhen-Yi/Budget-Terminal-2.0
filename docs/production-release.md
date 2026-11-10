# Production release configuration

> Historical record-sync work: the repository database feature has been restored to commit `3208321debc5e46712d95fb36db563c59e9ba80c`. The implementation and setup now follow [optional Convex snapshot sync](convex-sync.md). The protocol 2 release workflow below is no longer active in this checkout. A later repair deployed the matching snapshot backend to the existing saved-data development service after a private backup and record/snapshot comparison; existing records and accounts were retained. Live desktop sync subsequently reached revision 22. See the follow-up repair in the sync guide. The separate production service remains unchanged.

Configured on 2026-11-10. The backend and production GitHub OAuth credentials are installed. Production preflight and the live GitHub authorization redirect pass; completed browser sign-in and rollout acceptance remain pending.

| Setting | Public value / status |
| --- | --- |
| Production backend | `https://wonderful-otter-684.ap-southeast-2.convex.cloud` |
| Authentication site | `https://wonderful-otter-684.ap-southeast-2.convex.site` |
| GitHub OAuth callback | `https://wonderful-otter-684.ap-southeast-2.convex.site/api/auth/callback/github` |
| Backend protocol | 2, deployed and queried successfully |
| Signing/discovery | Independent RSA keys installed; public discovery/JWKS respond successfully |
| Auth logging | `ERROR` |
| GitHub OAuth Client ID / Client Secret | Installed through secure input; production backend only |
| Existing development account/library | Preserved; local launchers keep their existing endpoint |

The production deployment was exported to a private operator backup outside the repository before configuration. No development accounts, financial records, browser sessions or keys were copied into production. The public URL is stored in `apps/desktop/config/cloud-sync.json`; private signing material is stored only in the production backend. Temporary provisioning files were removed. A stray variable created during the first Windows command invocation was removed and the intended names were verified.

## OAuth setup and verification

Register a separate GitHub OAuth App for this production callback, using a service-owned GitHub account or organization. Keep the existing development OAuth App unchanged. Install the new Client ID and Client Secret as `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` on the **production** Convex deployment, through secure input or the private deployment environment settings. Never put either value in source, build variables or renderer configuration. The signing settings `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` and `AUTH_LOG_LEVEL` are already installed; do not regenerate them to complete OAuth setup.

On 2026-11-10, the operator supplied the production Client ID and Client Secret through separate secure inputs. Both were installed together on the explicitly selected `wonderful-otter-684` deployment. Existing signing settings and the development deployment were left unchanged. Temporary provisioning files were removed. Neither credential is recorded here or in application configuration.

Recheck with:

```text
npm run check:production
npm run probe:cloud-signin-live -- https://wonderful-otter-684.ap-southeast-2.convex.cloud
npm run build:release
```

The live sign-in probe checks the backend and GitHub authorization redirect and cancels its temporary callback listener. It does not approve a GitHub login or read a user's saved records. Complete a real production sign-in and the account/device acceptance checks in `docs/convex-sync.md` before distribution.

## Build and validation

`npm run build:release` performs the production preflight and sets the production URL explicitly for the child build. It rejects a missing endpoint, incompatible backend, missing GitHub configuration, enabled email provider, mismatched issuer/JWKS location, invalid/weak public RSA keys or accidentally published private key material. Network/provider failures are reported without copying raw responses into logs. `npm run build:local` preserves the existing source-install account and does not require production availability.

`npm run probe:release` runs isolated tests for that gate and the signing-key generator. The generator emits a valid dotenv file, refuses to overwrite existing material, and its public/private RSA pair is verified with a synthetic signature. No real credentials are printed or stored by the probe.

The initial configuration run passed typecheck, the release probe, launcher probe, cloud configuration/sync/OAuth probes and repository privacy checks. Its production-target candidate bundle also compiled, and a scan of its 30 JavaScript/HTML/CSS assets found the configured production endpoint, no development endpoint, and no high-confidence private-key/GitHub-token pattern. This scoped scan is not a guarantee against every credential format. The production backend's RSA public/private pair was checked with an in-memory signature; private material was neither printed nor published.

After OAuth installation, `check:production` passed protocol, GitHub-only configuration, discovery and public-key validation. `probe:cloud-signin-live` passed the production GitHub authorization redirect and safe callback cancellation. These checks confirm configuration and redirect behavior; they do not exchange a real GitHub authorization code or prove that the supplied Client Secret is accepted by GitHub. Complete the browser sign-in acceptance before distribution.

The post-setup `build:release`, typecheck, release probe, launcher probe and agent/browser privacy checks passed. Build and launcher verification used the launcher's installed Node.js 24.22.1; the shell's Node.js 22.23.2 correctly failed the repository's runtime security requirement. An exact-value scan found neither supplied OAuth credential in 1,696 tracked/source and generated output files. Both secure-input files and the temporary upload file were removed. All three double-click launchers were updated; their local-account behavior is preserved.

Application bundles are written to `apps/desktop/out/`. This repository does not currently package/sign installers, configure auto-updates or publish GitHub releases. Do not describe a successful bundle build as a signed installer or public release.

Public rollout acceptance remains separate: controlled production sign-in, two accounts/devices, deployed quota and cleanup/deletion checks, representative load/cost measurement, platform backups/budget alerts and the published privacy/retention/support policy. Keep `database.md` until those requirements are verified.

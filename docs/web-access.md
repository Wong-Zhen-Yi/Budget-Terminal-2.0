# Budget Terminal Remote on iPad through Tailscale

Budget Terminal can serve its interface to Chrome or Safari on your iPad while the Windows desktop app continues to own saved data and provider connections. Portfolios, Cards, personal finance and app settings are shared; page selections and temporary research controls belong to each browser. The PC must stay awake, online, and running Budget Terminal. Closing the Windows app stops Remote connections but preserves approved browsers.

## First setup

1. From the repository root, run `npm run build`. Remote serves `apps/desktop/out/renderer`, so rebuild after changing the interface. Start or restart Budget Terminal normally (`npm run dev` for this source checkout).
2. Install and connect Tailscale on the PC and iPad, using your private tailnet. Configure tailnet grants/access rules so only your intended user or devices can reach this PC on HTTPS port 443. Broad existing tailnet rules still grant access; review those as well.
3. Select **Remote** beside the MCP indicator in the desktop top bar, or open **Settings → Remote**, and enable Remote. The server listens only on `127.0.0.1:4317`. The enabled flag survives app restarts. The top bar shows **Connected** for active browser connections, **Ready** when the server is waiting, and **Off** when disabled.
4. In PowerShell on the PC, run:

   ```powershell
   tailscale serve --bg http://127.0.0.1:4317
   tailscale serve status
   ```

   Follow Tailscale's HTTPS setup prompts if needed. If Serve already hosts another app on port 443, review its configuration before replacing that route. Use Tailscale Serve for private access; do not enable public Funnel for this workspace.
5. With Tailscale connected on the iPad, open the HTTPS URL printed by Serve in Chrome. The desktop Settings panel also shows the PC's discovered `.ts.net` address.
6. Enter the four-digit pairing code from Remote. Codes expire after ten minutes and can be used once. **New pairing code** generates another code; pairing also rotates the displayed code automatically. Alternatively, tap **Request Access**. A **Review access (N)** button appears beside Remote in the PC top bar; select it to review requests without changing pages, or open **Settings → Remote**. Match the request reference on both screens and choose **Approve** or **Decline**. Approved requests open the iPad terminal automatically without entering a code. Requests expire after five minutes. Paired and approved browsers remain authorized across app and PC restarts; reopening the browser renews access for 30 days.

Tailscale is detected when the Remote server starts. If you install/connect Tailscale or rename the PC after enabling Remote, disable and enable Remote again to discover the new hostname. **Log out**, disabling Remote, or **Log out all browsers** removes remembered access; 30 days without reopening also expires it. The PC saves only session token hashes, expiry times and origins in `remote-sessions.json`. Raw session cookies, CSRF tokens, pairing codes and pending requests are never saved. Saved approvals are excluded from backups.

## Using the browser

- All implemented pages start loading after pairing, including pages you have not visited. Startup progress, failures and degraded feeds remain visible.
- Desktop and browser use the same provider rate gate and service cache. Identical simultaneous service reads are coalesced.
- Saved-data mutations notify connected clients. The browser reconnects its event stream and refreshes saved records/stale queries after resuming.
- On iPad mini, use **Choose a page** in either orientation. The dashboard fits the screen with options below the chart; portrait stacks the chart and holdings vertically. Scroll down for the remaining panels. Dense research tables on other pages scroll horizontally, and touch controls retain larger targets.
- Clipboard, links and text exports use browser functions. Desktop window controls, MCP screenshots, host configuration, backups, import, clear-data and cache-reset operations remain desktop functions.
- **Log out** ends that browser session. Web query snapshots stay in memory, and browser research state is cleared when logging out or being revoked.

## Troubleshooting

- **Server stopped:** run `npm run build`, check that port 4317 is free, then disable/enable Remote. Errors are shown in Remote.
- **Chrome cannot connect:** verify that the PC is awake, Budget Terminal is running, both devices are connected to Tailscale, `tailscale serve status` shows the localhost target, and tailnet access rules allow HTTPS.
- **Unrecognized HTTPS proxy:** reconnect Tailscale and disable/enable Remote. The server accepts only its discovered Tailscale hostname and checks forwarded HTTPS headers and request origins.
- **Pairing rejected:** get a new code on the desktop. Pairing allows ten attempts per minute and at most ten attempts per code. An exhausted code requires **New pairing code** on the PC.
- **Access request waiting:** select **Review access (N)** beside Remote in the PC top bar or approve the matching reference in **Settings → Remote**. Pending requests survive browser reloads and expire after five minutes. Declined or expired requests can be submitted again; access requests are limited to five new requests per minute across the host.
- **Old interface after an update:** rebuild, restart Budget Terminal and reload Chrome. The server sends `Cache-Control: no-store` for the interface and API.
- **PC restarted:** start Budget Terminal again and reopen Chrome at the same address. Approved browsers reconnect automatically while their cookie is valid. Tailscale Serve's background configuration can persist independently of the app.

For a local PC browser smoke test, use `http://127.0.0.1:4317` and pair normally. Local HTTP and Tailscale HTTPS sessions are separate. External devices cannot reach this loopback address directly.

## Verification

```powershell
npm run typecheck
npm run build
npm run probe:web
npm run probe:web-ui
npm run probe:charts -- --offline
npm run probe:readiness-ui
```

The web probes use temporary data directories and synthetic/offline inputs. `probe:web` verifies pairing, origin/CSRF protection, service validation and restrictions, saved-data events, revocation, rate limiting and HTTPS proxy cookies. `probe:web-ui` exercises the built browser entry and responsive shell in Chromium without an Electron preload. A real Chrome/Tailscale check on your iPad remains the device acceptance check.

References: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), [tailnet access control](https://tailscale.com/docs/features/access-control).

# Use Budget Terminal on phones and tablets

Mobile Access opens the Budget Terminal workspace in your phone or tablet browser while Budget Terminal is running on your computer. The browser uses the same saved records and market services. Its page navigation, chart view, and scroll positions are separate from the desktop window.

## Open the connected mobile window on Windows

In the Windows desktop app, go to **Settings → Labs → Mobile Access**, choose a phone size, and select **Open phone viewport**. Choose Compact phone (320 × 568), Small phone (360 × 780), Phone (390 × 844), or Large phone (430 × 932). These are generic CSS viewport sizes, not device models. Resize the window to try intermediate sizes and landscape proportions. It initially fits the desktop window's monitor and works with Tailscale off.

Run `btd mobile` to build and open the current version. If the desktop is open, the command closes it gracefully and waits for pending saves before rebuilding. It opens the desktop and the viewport together. Use it after a source update.

## Preview the mobile UI with sample data

Run `btd -MobilePreview` (or `sh scripts/launch-posix.sh --mobile-preview` on macOS and Linux). It builds the current code and opens Budget Terminal's mobile interface in an Electron window. The default viewport is 390 × 844 CSS pixels at 2× device pixel ratio. The window initially fits your monitor; dragging its edges changes the viewport and reflows the interface. Actual phones use their own browser width, height, pixel density, and safe areas automatically.

Add `-Dev` (`btd -MobilePreview -Dev`, or `node scripts/launch.cjs --mobile-preview --dev`) to serve the phone interface from the Vite dev server instead of the last build. Source edits hot-reload in the window. In every development run (`btd -Dev`), the connected mobile window and Mobile Access links also load the phone UI from Vite. The mobile server keeps its own token, Tailscale owner, origin and CSP checks, proxies only page assets and the Vite HMR socket to the local dev server, and keeps `/api/call` and `/api/events` in the main process. Development pages allow only the hashed React Refresh preamble that Vite injects, never other inline scripts. Packaged and production builds still serve `out/renderer`.

The preview starts with the repository's sample records and discards edits when closed. It can run alongside the regular desktop window and needs only the local computer. Keep its terminal open. Relaunch after editing the source to rebuild, or press **F5** to reload the current build. Use Safari on an iPhone to check WebKit behavior and iOS safe areas.

## Set up the computer

1. Sign in to [Tailscale](https://tailscale.com/download) on the computer and on your phone or tablet using the same account. Turn on Tailscale on both devices. The HTTPS link uses [MagicDNS](https://tailscale.com/docs/features/magicdns).
2. Start Budget Terminal with its double-click launcher. Open **Settings → Labs → Mobile Access** and enable it.
3. If the panel asks for a proxy, expand **Set up Tailscale links** and select **Copy setup commands** to copy the commands for any links that still need configuration. Use an Administrator terminal on Windows. Follow Tailscale's prompt if HTTPS needs to be enabled. The HTTPS command uses a dedicated port, so it can coexist with an existing site on port 443. If port 8443 already hosts another service, resolve that conflict before running the command. [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve)

   ```sh
   tailscale serve --bg --https=8443 http://127.0.0.1:4387
   ```

4. Click **Check connection**. Select **QR code** next to the direct or HTTPS link and scan it with your phone’s camera while Tailscale is connected. You can also copy either URL or request the links from Telegram. Keep Budget Terminal open on the computer. The links resume working when the app is relaunched.

If Budget Terminal says the computer is disconnected from Tailscale, open the **Tailscale** app on the computer and wait for it to connect before checking again. On Windows, open it from the Start menu if its icon is missing from the system tray.

## Get the link from Telegram

Enable **Receive research questions from Telegram** under **Agents → Telegram** on the computer. Send `/mobile` in the configured private bot chat to turn on Mobile Access on the computer and get the links. The setting stays on until you turn it off in **Settings → Labs**. If it is already on, you can also ask “Send me the Budget Terminal mobile link.” Tap the link while Tailscale is connected. Open it in your device browser from Telegram and optionally add it to your Home Screen. [Telegram setup](agents.md#telegram)

Budget Terminal looks up the link locally and replies in the configured private chat. Link delivery uses zero Codex tokens and works without Codex sign-in. The link carries no token. Budget Terminal checks that the visiting device uses the same Tailscale account as the computer on each request. Use Tailscale Serve for this port. Funnel and tagged devices do not provide the required user identity.

## Use a direct link without DNS

The direct link uses the computer’s Tailscale IPv4 address. It works with **Use Tailscale DNS** off on the phone or tablet and has no Docker, Pi-hole, or custom DNS dependency. Set it up alongside the HTTPS link with this command. Use an Administrator terminal on Windows. [Tailscale TCP forwarding and PROXY protocol](https://tailscale.com/docs/reference/tailscale-cli/serve)

```sh
tailscale serve --bg --tcp=8081 --proxy-protocol=1 tcp://127.0.0.1:4388
```

Select **Check connection** in **Settings → Labs → Mobile Access**, copy the direct link, or send `/mobile`. Connect Tailscale on the device with the same account as the computer, then paste the full `http://` link into your browser. The link uses HTTP inside Tailscale’s encrypted transport. Your browser may label the connection HTTP. The app accepts the direct connection only from the same-account devices that Tailscale identifies.

For the HTTPS link, turn on **Use Tailscale DNS** in the Tailscale app. Disconnect and reconnect in Tailscale if your browser reports that it can’t find the address. [Tailscale DNS troubleshooting](https://tailscale.com/docs/reference/troubleshooting/resolve-domain-names-failure)

## What you can do on mobile

Tap the current page name to open **Workspaces**. Browse the page pills under each workspace or search by page or workspace name. Narrow screens collapse secondary tools and stack panels; wider or landscape screens reflow according to their available space. The list follows your navigation settings, including enabled Labs. Most research views use the same charts, filters, and tables. Swipe across wide tables and scroll through stacked panels on narrow screens. Wide tables keep their ticker or name column in place while the other columns move, and a fade at the edge of a table or tab row shows there is more to swipe to. Portfolio, Cards, Personal Finance, and Articles edits save to the shared desktop records. You can download a backup, export individual article PDFs, or export the article library as a ZIP of PDFs. The mobile ZIP accepts up to 60 articles and has a 64 MB output limit.

Your browser's Back gesture or button returns to the page you came from and closes **Workspaces**. Forward works the same way, and reloading keeps the current page. Double-tap a row or tile where the desktop uses a double-click, for example to open a stock from Technical Indicators or a tile from Heatmap. Pinch to zoom the index heatmap and the price charts. Ticker fields open the keyboard in capitals without autocorrect.

To use Budget Terminal like an app, choose **Add to Home Screen** from Safari's Share menu or Chrome's menu. It then opens full screen without browser bars. iOS has no Back gesture in that mode, so a Back button appears at the left of the header once you have moved between pages.

Browser opens searches and websites in your device browser. YouTube playback opens on the device, and Agents opens your Telegram bot. The computer handles its signed-in Chromium profile, desktop agent history and trackers, account credentials, MCP controls, and system maintenance. Notifications are visible in the app inbox, with native desktop delivery handled by the computer.

Turn off **Mobile Access** under **Settings → Labs** to stop serving the workspace immediately. To remove its Tailscale proxies, run `tailscale serve --https=8443 off` and `tailscale serve --tcp=8081 off`. The preference is local to this computer. Demo profiles cannot be shared.

## Verification

Mobile service calls release the browser connection while the computer waits for a provider, then collect results with authenticated same-origin polling. This keeps startup preloading for every page from occupying the limited connections on direct HTTP Tailscale links. Results stay in memory for up to two minutes after completion and are removed when collected or mobile access disconnects.

The mobile preview probe also checks the Back gesture, double-tap, frozen table columns, 44-pixel controls and hidden repeated page titles. Add `--all-pages` to the mobile preview startup probe to check every available page for render failures or collapsed content areas at a phone viewport. This checks rendering and transport separately from live provider availability.

Run `npm run probe:desktop-startup --workspace budget-terminal-desktop -- --mobile-preview` after a build to check window resizing, temporary sample data, mobile navigation, and compact toolbars across phone widths from 320 to 430 CSS pixels plus landscape layouts in Electron.

On Windows, run `npm run probe:desktop-startup --workspace budget-terminal-desktop -- --connected-mobile` to test shared data and update events. Add `--warm` to test opening the mobile window from an already running desktop instance.

Add `--labs` to the connected mobile probe to open the window from **Settings → Labs** and check the selected viewport.

After a production build, run `npm run probe:mobile --workspace budget-terminal-desktop` and `npm run probe:telegram --workspace budget-terminal-desktop`. Check real Android and iOS browsers in both orientations, including browser chrome, the on-screen keyboard, and safe areas. Presets are examples; the layout responds continuously to available space without identifying a phone model.

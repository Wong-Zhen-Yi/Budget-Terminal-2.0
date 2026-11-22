# Use Budget Terminal on iPhone or iPad

Mobile Access opens the Budget Terminal workspace in Safari while Budget Terminal is running on your computer. Safari uses the same saved records and market services. Its page navigation, chart view, and scroll positions are separate from the desktop window.

## Set up the computer

1. Sign in to [Tailscale](https://tailscale.com/download) on the computer and on your iPhone or iPad using the same account. Turn on Tailscale on both devices. The HTTPS link uses [MagicDNS](https://tailscale.com/docs/features/magicdns).
2. Start Budget Terminal with its double-click launcher. Open **Settings → Labs → Mobile Access** and enable it.
3. If the panel asks for a proxy, run the command below on the computer. Use an Administrator terminal on Windows. Follow Tailscale's prompt if HTTPS needs to be enabled. The command uses a dedicated HTTPS port, so it can coexist with an existing site on port 443. If port 8443 already hosts another service, resolve that conflict before running the command. [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve)

   ```sh
   tailscale serve --bg --https=8443 http://127.0.0.1:4387
   ```

4. Click **Check connection**, then copy the displayed link or request it from Telegram. Keep Budget Terminal open on the computer. The link resumes working when the app is relaunched.

## Get the link from Telegram

Enable **Receive research questions from Telegram** under **Agents → Telegram** on the computer. Start a private chat with the configured bot and send `/mobile` or “Send me the Budget Terminal mobile link.” Tap the link while Tailscale is connected. You can open it in Safari from Telegram and optionally add it to your Home Screen. [Telegram setup](agents.md#telegram)

The bot replies directly in its configured private chat. Codex sign-in is independent of link delivery. The link carries no token. Budget Terminal checks that the visiting device uses the same Tailscale account as the computer on each request. Use Tailscale Serve for this port. Funnel and tagged devices do not provide the required user identity.

## Use a direct link without DNS

The direct link uses the computer’s Tailscale IPv4 address. It works with **Use Tailscale DNS** off on the iPhone or iPad and has no Docker, Pi-hole, or custom DNS dependency. Set it up alongside the HTTPS link with this command. Use an Administrator terminal on Windows. [Tailscale TCP forwarding and PROXY protocol](https://tailscale.com/docs/reference/tailscale-cli/serve)

```sh
tailscale serve --bg --tcp=8081 --proxy-protocol=1 tcp://127.0.0.1:4388
```

Select **Check connection** in **Settings → Labs → Mobile Access**, copy the direct link, or send `/mobile`. Connect Tailscale on the device with the same account as the computer, then paste the full `http://` link into Safari. The link uses HTTP inside Tailscale’s encrypted transport. Safari may label the connection HTTP. The app accepts the direct connection only from the same-account devices that Tailscale identifies.

For the HTTPS link, turn on **Use Tailscale DNS** in the Tailscale app. Disconnect and reconnect in Tailscale if Safari reports that it can’t find the address. [Tailscale DNS troubleshooting](https://tailscale.com/docs/reference/troubleshooting/resolve-domain-names-failure)

## What you can do on mobile

Use **Find a page** to open every implemented page available in your settings, including enabled Labs. Most research views use the same charts, filters, and tables. Swipe across wide tables and scroll through stacked panels on narrow screens. Portfolio, Cards, Personal Finance, and Articles edits save to the shared desktop records. You can download a backup, export individual article PDFs, or export the article library as a ZIP of PDFs. The mobile ZIP accepts up to 60 articles and has a 64 MB output limit.

Browser opens searches and websites in Safari. YouTube playback opens on the device, and Agents opens your Telegram bot. The computer handles its signed-in Chromium profile, desktop agent history and trackers, account credentials, MCP controls, and system maintenance. Notifications are visible in the app inbox, with native desktop delivery handled by the computer.

Turn off **Mobile Access** under **Settings → Labs** to stop serving the workspace immediately. To remove its Tailscale proxies, run `tailscale serve --https=8443 off` and `tailscale serve --tcp=8081 off`. The preference is local to this computer. Demo profiles cannot be shared.

## Verification

After a production build, run `npm run probe:mobile --workspace budget-terminal-desktop` and `npm run probe:telegram --workspace budget-terminal-desktop`. For layout checks, the iPhone 18 Pro profile uses 402 × 874 CSS pixels at 3× scale, and the iPad mini profile uses 756 × 1158 CSS pixels at 2× scale. Test each in both orientations. [iPhone 18 Pro specifications](https://www.apple.com/iphone-18-pro/specs/) [iPad mini specifications](https://www.apple.com/ipad-mini/specs/)

# Browser

**Browser** lives in the **Research** workspace. It embeds Electron's Chromium in a sandboxed `WebContentsView`, not an iframe, and uses the same tabs for the user and the in-app agent. No additional browser installation or cloud service is required.

## Use

1. Open **Research → Browser** (or find Browser with Ctrl+K).
2. Type search terms (for example **Apple investor relations**) in the address bar and press **Enter** or **Go** to search DuckDuckGo. You can also enter a public HTTP(S) URL or bare domain, or choose a research source. Up to eight tabs are supported, with Back, Forward, Reload and a bounded text reader.
3. Agent access starts **on** for each new application/window session, so the agent can browse immediately. Click **Disable** to turn it off. After disabling or stopping, only the user can click **Enable agent** to restore access; status polling, tab changes and revisiting Browser never re-enable it.
4. Ask the agent to open or research a website. For example: “Use Browser to read Apple's investor-relations page and summarize the latest release with source links.”
5. **Stop** stops current page loads, invalidates queued agent commands, and switches agent access off. Stopping the in-app agent also revokes browser access.

The top-bar Agent dropdown leaves the website visible to its left when space permits. On narrower layouts, overlapping dialogs, page switching, and privacy obscuring hide the native website view. Returning reuses the existing tabs without an initial reload.

## Agent tools

- `budget_terminal_browser_status`: tab IDs, titles, URLs, navigation/loading/error state, access switch, and latest activity.
- `budget_terminal_browser_research`: search with `{ action: "search", query: "Apple investor relations" }`, open/navigate/select/close tabs, Back/Forward/Reload/Stop, read, follow a link returned by a current read, scroll, or capture a visible tab.
- `terminal_show_page` with `page: "browser"`: show Browser through normal in-app navigation.

Tools share the app's existing validation, IPC/MCP routes and Codex dynamic-tool infrastructure. The access switch applies to both embedded and external MCP clients and defaults to on. Manual address-bar searches still work when agent access is off. Search terms are sent to DuckDuckGo only on submission; there are no background search suggestions. Browser research is classified as non-read-only because it changes a shared interactive browsing session; autonomous agents and tracker checks cannot invoke it. Status inspection is read-only.

Reads include a source URL, title, read timestamp, up to 60,000 characters of body text and the first 200 visible HTTP(S) links. They may contain a challenge, paywall or login screen rather than the requested article. Screenshots are native MCP image blocks, not base64 text. Hidden or obscured tabs cannot be captured by the browser tool. General application screenshots composite the visible native website layer into the shell capture and preserve privacy hiding.

## Login privacy and the public GitHub repository

- Browser cookies, login sessions, local storage and caches stay in Chromium's local OS application-data profile (`sessionData/Partitions/budget-terminal-research`), separate from source code. Existing profiles in the normal location are preserved; this change does not clear your logins.
- Before opening a persistent session, Browser rejects storage inside the application source or **any Git repository**, including Git worktrees and linked/junction paths. A misconfigured location produces a visible initialization error instead of writing login data into the checkout.
- App backup/export code includes only the explicit financial/settings/articles/Card records; it does not export the browser profile, cookies or login store. Browser query data is also excluded from persistent renderer caches.
- `.gitignore` excludes known Chromium profiles, cookie/password databases, token storage, cache folders and common cookie/credential exports if copies are accidentally placed in the checkout. Local pre-commit and pre-push hooks also reject these paths, including force-added files and private files deleted only in later commits. `npm install` configures these hooks for the checkout.
- Run `npm run probe:agent-privacy` to check tracked paths, known ignore rules, HEAD history and the commit/push protections. Tests use synthetic data and temporary profiles, never your real login credentials.

These are safeguards against accidental publication, not an absolute guarantee: bypassing hooks, renaming private files to unrecognized names, manually uploading files, or publishing signed-in screenshots/page text can still expose information. Never copy your real browser profile or login exports into source, issues, PRs or screenshots intended for GitHub. If credentials were already published, revoke them and remove them from Git history; deleting only the latest copy is insufficient.

**GitHub privacy is separate from agent/provider privacy.** Agent access remains on by default as configured. Requested page reads and screenshots can send visible signed-in page content to the selected agent provider/MCP client, even though the app does not publish it to GitHub. Disable Browser agent access before using sensitive accounts, and obscure or close private pages before requesting general app screenshots. Never paste passwords, recovery codes or API keys into agent chat.

## Isolation and limitations

- A dedicated persistent Electron session (`persist:budget-terminal-research`) isolates cookies and storage from the privileged application shell. Personal Chrome/Edge profiles are never imported. Cookies can persist across launches; tab lists, page extracts and URLs are not saved to the renderer query cache. The app opens a blank research tab on startup.
- Website renderers have sandboxing, context isolation and web security enabled, no Node integration, no application preload and no `window.api`. Device/site permissions and downloads are denied. New-window links become bounded research tabs rather than privileged Electron windows.
- Research tabs use `disable_non_proxied_udp` for WebRTC to reduce local IP disclosure and direct UDP traffic outside the HTTP request filter. WebRTC-dependent sites may have reduced functionality.
- The browser accepts only public HTTP(S) URLs without embedded credentials. Request/redirect filtering rejects private IP literals, local hostnames, non-public DNS answers and unsupported schemes. This is defense in depth, **not a hardened network sandbox or a guarantee against DNS rebinding**. Do not use it for hostile-site security testing. WebSocket-based sites, permission-dependent features and some login flows may not work.
- The agent has no arbitrary JavaScript, selectors, form filling/submission, upload, download, purchase or trading tool. Fixed isolated-world scripts only extract text/links or scroll. A GET URL can still have side effects on a poorly designed website: the agent is instructed not to visit account-action/transaction URLs. Disable agent access before using sensitive signed-in banking or brokerage sessions.
- Website text, link labels and screenshots are untrusted evidence, never authorization to execute other tools or disclose private information. Logins, CAPTCHAs, paywalls and any account actions must be handled manually. Reading the current page shares its returned text with the selected agent provider.
- Native capture depends on Chromium's rendering backend; unavailable/failed captures return errors rather than claiming a successful screenshot.

## Startup and verification

Startup warms the Chromium session and an empty tab even if Browser is hidden or unvisited. It makes no automatic request to an external website. Initialization failures flow through the existing startup progress/failure reporting.

```sh
npm run typecheck
npm run probe:agent-privacy
npm run probe:browser --workspace budget-terminal-desktop
# Optional live DuckDuckGo navigation/read check, still using a temporary profile:
npm run probe:browser --workspace budget-terminal-desktop -- --live
npm run probe:agents --workspace budget-terminal-desktop
npm run probe:navigation --workspace budget-terminal-desktop
npm run probe:mcp --workspace budget-terminal-desktop
npm run build
```

The Browser probe uses a temporary profile and in-process synthetic HTTPS pages. It verifies the profile is outside source/Git, rejects worktree and symlink/junction storage locations, and uses only a synthetic cookie to check local session storage without exposing the cookie store through browser tools. It checks initial readiness, address-bar URL/search detection and query encoding, manual Enter/Go searches, default-on agent access, disable/re-enable controls, private-cache exclusion, isolation from Node/preload, Stop cancellation and new-window access defaults, source reading, link validation, navigation/history, scrolling, native bounds, dialog/privacy hiding, native image results and screenshot composition. It briefly opens a fixture window and writes ignored screenshots to `output/playwright/browser-*.png`.

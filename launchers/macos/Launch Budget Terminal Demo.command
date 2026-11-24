#!/bin/sh
# The shared build loads the open mobile page before background preloads for unseen pages, so Polymarket appears promptly.
# The shared build lets phone pages such as Polymarket, Charts, Valuation, Economic and Dictionary scroll their headers away.
# GitHub demo screenshots reflect the current app; this launcher rebuilds desktop and MCP source.
# The shared build includes single-line mobile toolbars and swipeable tab groups.
# The shared build adapts mobile layouts to compact, standard, large and landscape phone sizes.
# The shared build adds /prompts to Telegram for the four Agents quick prompts.
# The shared build includes the one-click phone viewport for Windows.
# The shared build includes animated reload progress on desktop and mobile.
# The shared build includes the Forex currency converter with SGD to USD selected by default.
# The shared build includes the mobile Workspaces page with grouped page pills.
# The shared build includes 17 staggered index callouts inside the mobile Global map.
# The shared build includes compact Portfolio and research toolbars for phone layouts.
# The shared build includes the mobile Dashboard 2.0 portfolio stack and Agent Chat card.
# The connected mobile launcher in Settings Labs is available in the regular Windows desktop session.
# Use the regular desktop session to copy Tailscale setup commands for a phone.
# The shared build includes direct Telegram /mobile and /restart handling.
# Pass --mobile-preview to try collapsible mobile News filters and tools with the same sample data.
# The connected mobile window is available through the Windows launcher.
# Finder entry point for the temporary demo profile, using the macOS desktop launcher.
cd "$(dirname "$0")" || exit 1
exec /bin/sh './Launch Budget Terminal.command' --demo "$@"

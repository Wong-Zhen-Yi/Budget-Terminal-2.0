#!/bin/sh
# The connected mobile launcher in Settings Labs is available in the regular Windows desktop session.
# Use the regular desktop session to copy Tailscale setup commands for a phone.
# The shared build includes direct Telegram /mobile and /restart handling.
# Pass --mobile-preview to try collapsible mobile News filters and tools with the same sample data.
# The connected mobile window is available through the Windows launcher.
# Finder entry point for the temporary demo profile.
cd "$(dirname "$0")" || exit 1
exec /bin/sh './Launch Budget Terminal.command' --demo "$@"

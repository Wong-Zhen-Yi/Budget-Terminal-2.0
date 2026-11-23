#!/bin/sh
# The shared build includes direct Telegram /mobile and /restart handling.
# Pass --mobile-preview to check the current iPhone portrait layouts with the same sample data.
# The connected mobile window is available through the Windows launcher.
# Finder entry point for the temporary demo profile.
cd "$(dirname "$0")" || exit 1
exec /bin/sh './Launch Budget Terminal.command' --demo "$@"

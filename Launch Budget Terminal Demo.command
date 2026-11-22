#!/bin/sh
# The shared build includes the compact iPhone navigation and touch-friendly page picker.
# Finder entry point for the temporary demo profile.
cd "$(dirname "$0")" || exit 1
exec /bin/sh './Launch Budget Terminal.command' --demo "$@"

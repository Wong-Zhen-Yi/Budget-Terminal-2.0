#!/bin/sh
# Finder entry point for the temporary demo profile.
cd "$(dirname "$0")" || exit 1
exec /bin/sh './Launch Budget Terminal.command' --demo "$@"

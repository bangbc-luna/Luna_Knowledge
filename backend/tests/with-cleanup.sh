#!/usr/bin/env sh
pnpm test:cleanup || exit 1
"$@"
code=$?
pnpm test:cleanup
exit $code

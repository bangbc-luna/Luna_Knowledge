#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source <(sed -n '/^url_decode()/,/^}/p;/^url_user()/,/^}/p' common.sh)

fail=0
check() {
  local got
  got="$(url_user "$1")"
  if [[ "$got" == "$2" ]]; then
    echo "ok   $1 -> $got"
  else
    echo "FAIL $1 -> '$got' (muốn '$2')"
    fail=1
  fi
}

check 'postgresql://luna:secret@db:5432/luna' 'luna'
check 'postgresql://luna%40corp:p%40ss@db:5432/luna' 'luna@corp'
check 'postgresql://ch%E1%BB%A7%20db:x@db/luna' 'chủ db'
check 'postgresql://back%5Cslash:x@db/luna' 'back\slash'
check 'postgresql://luna@db/luna' 'luna'
check 'postgresql://bad%zzuser:x@db/luna' 'bad%zzuser'
check 'postgresql://half%2:x@db/luna' 'half%2'
check 'postgresql://db/luna' ''
exit "$fail"

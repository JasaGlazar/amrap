#!/usr/bin/env bash
set -euo pipefail

deno_version=2.1.4
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run() {
  local dir="$1"
  shift
  if command -v deno >/dev/null 2>&1; then
    (cd "$root/$dir" && deno "$@")
  else
    docker run --rm -v "$root:/w" -w "/w/$dir" "denoland/deno:$deno_version" deno "$@"
  fi
}

for config in "$root"/supabase/functions/*/deno.json; do
  dir="${config#"$root"/}"
  dir="${dir%/deno.json}"
  echo "== $dir"
  run "$dir" fmt --check
  run "$dir" lint
  run "$dir" check index.ts
  run "$dir" test --allow-env
done

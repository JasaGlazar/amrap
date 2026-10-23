#!/usr/bin/env bash
# Docs 1:1 check: every migration file must be named in docs/schema.md and every
# public function a migration declares must be documented in docs/rpcs.md.
# Only supabase/migrations counts (not tests or seeds). Run from anywhere.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

missing=()

shopt -s nullglob
migrations=(supabase/migrations/*.sql)
if [ ${#migrations[@]} -eq 0 ]; then
  echo "check-docs: no migrations found in supabase/migrations" >&2
  exit 1
fi

for file in "${migrations[@]}"; do
  name="$(basename "$file")"
  grep -qF "$name" docs/schema.md || missing+=("docs/schema.md: migration $name")
done

# Function names come from the "create [or replace] function public.<name>" line only;
# the argument list may continue on later lines.
functions="$(grep -hiE '^[[:space:]]*create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+public\.[a-z_0-9]+' "${migrations[@]}" \
  | grep -ioE 'public\.[a-z_0-9]+' | sed 's/^[Pp][Uu][Bb][Ll][Ii][Cc]\.//' | tr 'A-Z' 'a-z' | sort -u)"

# Documented means a "## name" heading, or the name in backticks (`name`, `public.name(`).
for fn in $functions; do
  grep -qE "^## ${fn}\$|\`(public\.)?${fn}[\`(]" docs/rpcs.md || missing+=("docs/rpcs.md: function public.$fn")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "check-docs: documentation is missing for:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

echo "check-docs: ok (${#migrations[@]} migrations, $(echo "$functions" | wc -w | tr -d ' ') functions)"

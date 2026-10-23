#!/usr/bin/env bash
# Docs 1:1 check; what it enforces is in docs/harness.md "CI".
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

# Schema and name may be double-quoted, as in `supabase db diff` output.
q='"?'
functions="$(grep -hiE "^[[:space:]]*create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+${q}public${q}\.${q}[a-z_0-9]+" "${migrations[@]}" \
  | grep -ioE "${q}public${q}\.${q}[a-z_0-9]+" | tr -d '"' | sed 's/^[Pp][Uu][Bb][Ll][Ii][Cc]\.//' | tr 'A-Z' 'a-z' | sort -u || true)"
if [ -z "$functions" ]; then
  echo "check-docs: no 'create function public.<name>' declarations found in migrations" >&2
  exit 1
fi

for fn in $functions; do
  grep -qE "^## ${fn}\$|\`(public\.)?${fn}[\`(]" docs/rpcs.md || missing+=("docs/rpcs.md: function public.$fn")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "check-docs: documentation is missing for:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

echo "check-docs: ok (${#migrations[@]} migrations, $(echo "$functions" | wc -w | tr -d ' ') functions)"

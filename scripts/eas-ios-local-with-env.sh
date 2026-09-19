#!/usr/bin/env bash
# Local EAS does not copy gitignored .env into the archive sandbox.
# Export secrets into this process so app.config.js / Metro can bake them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env (needed for SUPABASE_SERVICE_ROLE_KEY)" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "SUPABASE_SERVICE_ROLE_KEY is empty in .env" >&2
  exit 1
fi
export EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY="${EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY:-$SUPABASE_SERVICE_ROLE_KEY}"
exec eas build --platform ios --profile production --local --non-interactive --wait --verbose-logs --output ./eas-local-ios.ipa

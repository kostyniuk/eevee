#!/bin/sh
set -eu

app_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
database_password=$(cat "$app_root/.secrets/postgres_password")
database_url="postgresql://eevee:${database_password}@127.0.0.1:5432/eevee"

unset VERCEL VERCEL_ENV VERCEL_OIDC_TOKEN VERCEL_TARGET_ENV

cd "$app_root"
postgres_was_running=false
fixture_root=
if docker compose ps --status running --services | grep -qx postgres; then
  postgres_was_running=true
fi

cleanup() {
  case "$fixture_root" in
    "$app_root"/fixtures/review-records-run.*) rm -rf -- "$fixture_root" ;;
  esac
  if [ "$postgres_was_running" = false ]; then
    docker compose stop postgres >/dev/null
  fi
}
trap cleanup EXIT INT TERM

docker compose up -d postgres

attempt=0
until docker compose exec -T postgres pg_isready -U eevee -d eevee >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Postgres did not become ready within 30 seconds." >&2
    exit 1
  fi
  sleep 1
done

DATABASE_DIRECT_URL="$database_url" DATABASE_URL="$database_url" npm run db:migrate

fixture_root=$(mktemp -d "$app_root/fixtures/review-records-run.XXXXXX")
mkdir -p "$fixture_root/agent/channels" "$fixture_root/agent/instructions"
cp "$app_root/package.json" "$fixture_root/package.json"
cp -R "$app_root/agent/lib" "$fixture_root/agent/lib"
cp "$app_root/agent/instructions/reviewer.ts" "$fixture_root/agent/instructions/reviewer.ts"
cp "$app_root/fixtures/review-records/agent/agent.ts" "$fixture_root/agent/agent.ts"
cp "$app_root/fixtures/review-records/agent/channels/github.ts" \
  "$fixture_root/agent/channels/github.ts"
cp -R "$app_root/fixtures/review-records/evals" "$fixture_root/evals"

cd "$fixture_root"
DATABASE_DIRECT_URL="$database_url" DATABASE_URL="$database_url" \
  "$app_root/node_modules/.bin/eve" eval review-records --max-concurrency 1

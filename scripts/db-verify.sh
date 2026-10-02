#!/usr/bin/env bash
# Applies all migrations to a throwaway Postgres 17 container (with a minimal
# Supabase stub) and runs the tenant-isolation test suite.
# Usage: npm run db:verify
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="sellflow-dbverify-$$"
IMAGE="${DB_VERIFY_IMAGE:-postgres:17-alpine}"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1

run_sql() {
  docker exec -i "$NAME" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"
}

echo "→ supabase stub"
run_sql < "$ROOT/supabase/tests/_supabase_stub.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  run_sql < "$f"
done

echo "→ tests"
for f in "$ROOT"/supabase/tests/*.sql; do
  [[ "$(basename "$f")" == _* ]] && continue
  run_sql < "$f"
done

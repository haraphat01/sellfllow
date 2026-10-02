#!/usr/bin/env bash
# Generates src/db/types/database.ts from the migrations using a throwaway
# Postgres container (fallback when `supabase gen types` can't run).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="sellflow-dbtypes-$$"
IMAGE="${DB_VERIFY_IMAGE:-postgres:17-alpine}"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 0.5; done
sleep 1

run_sql() { docker exec -i "$NAME" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

run_sql -o /dev/null < "$ROOT/supabase/tests/_supabase_stub.sql" 2>/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do run_sql -o /dev/null < "$f"; done

run_sql -At <<'SQL' | node "$ROOT/scripts/gen-db-types.mjs" "$ROOT/src/db/types/database.ts"
select json_build_object(
  'columns', (
    select json_agg(json_build_object(
      'table', c.table_name, 'name', c.column_name, 'pos', c.ordinal_position,
      'udt', c.udt_name, 'nullable', c.is_nullable = 'YES',
      'has_default', c.column_default is not null or c.is_identity = 'YES',
      'generated', c.is_generated = 'ALWAYS'))
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'),
  'enums', (
    select json_object_agg(typname, labels) from (
      select t.typname, json_agg(e.enumlabel order by e.enumsortorder) labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' group by t.typname) x),
  'fks', (
    select json_agg(json_build_object(
      'name', con.conname, 'table', cl.relname, 'column', att.attname,
      'ref_schema', rn.nspname, 'ref_table', rcl.relname, 'ref_column', ratt.attname,
      'one_to_one', exists (
        select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique
          and i.indnkeyatts = 1 and i.indkey[0] = con.conkey[1] and i.indpred is null)))
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    join pg_class rcl on rcl.oid = con.confrelid
    join pg_namespace rn on rn.oid = rcl.relnamespace
    join pg_attribute ratt on ratt.attrelid = con.confrelid and ratt.attnum = con.confkey[1]
    where con.contype = 'f' and n.nspname = 'public'),
  'functions', (
    select coalesce(json_agg(json_build_object(
      'name', p.proname,
      'returns', format_type(p.prorettype, null),
      'args', (
        select coalesce(json_agg(json_build_object(
          'name', p.proargnames[i],
          'udt', (select typname from pg_type where oid = p.proargtypes[i - 1]),
          'has_default', i > p.pronargs - p.pronargdefaults) order by i), '[]'::json)
        from generate_series(1, p.pronargs) i))), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public')
);
SQL

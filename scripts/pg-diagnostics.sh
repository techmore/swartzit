#!/usr/bin/env bash
set -euo pipefail

# Diagnostic-only PostgreSQL instrumentation. It is opt-in because
# shared_preload_libraries requires a database restart and should not be
# changed during a normal Swartzit upgrade.
DB_CONTAINER="${SWARTZIT_DB_CONTAINER:-swartzit-db}"
DB_USER="${SWARTZIT_DB_USER:-swartzit}"
DB_NAME="${SWARTZIT_DB_NAME:-swartzit}"
mode="${1:---check}"

command -v container >/dev/null 2>&1 || { echo "The container CLI is required." >&2; exit 1; }
container exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

if [[ "$mode" == "--enable" ]]; then
  current=$(container exec "$DB_CONTAINER" psql -X -qAt -U "$DB_USER" -d "$DB_NAME" -c "SHOW shared_preload_libraries")
  if [[ ",$current," != *,pg_stat_statements,* ]]; then
    next="$current"
    [[ -n "$next" ]] && next+=","
    next+="pg_stat_statements"
    container exec "$DB_CONTAINER" psql -X -qAt -U "$DB_USER" -d "$DB_NAME" -c "ALTER SYSTEM SET shared_preload_libraries = '$next'"
    echo "pg_stat_statements was added to shared_preload_libraries; restarting $DB_CONTAINER."
    container restart "$DB_CONTAINER" >/dev/null
    for _ in {1..30}; do
      container exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  container exec "$DB_CONTAINER" psql -X -qAt -U "$DB_USER" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
elif [[ "$mode" != "--check" && "$mode" != "--report" ]]; then
  echo "Usage: $0 [--check|--enable|--report]" >&2
  exit 2
fi

preload=$(container exec "$DB_CONTAINER" psql -X -qAt -U "$DB_USER" -d "$DB_NAME" -c "SHOW shared_preload_libraries")
echo "shared_preload_libraries=${preload:-<empty>}"
if [[ "$mode" == "--report" ]]; then
  container exec "$DB_CONTAINER" psql -X -U "$DB_USER" -d "$DB_NAME" -c \
    "SELECT calls, round(total_exec_time::numeric, 2) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms, rows, left(query, 120) AS query FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) ORDER BY total_exec_time DESC LIMIT 25"
else
  container exec "$DB_CONTAINER" psql -X -qAt -U "$DB_USER" -d "$DB_NAME" -c \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') THEN 'pg_stat_statements=installed' ELSE 'pg_stat_statements=not-installed' END"
fi

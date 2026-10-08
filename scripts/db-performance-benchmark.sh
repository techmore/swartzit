#!/usr/bin/env bash
set -euo pipefail

# Runs the read-path benchmark against a disposable SQLite file. The live
# Swartzit database is never used or modified.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
API_PORT="${SWARTZIT_PERF_API_PORT:-18180}"
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/swartzit-perf.XXXXXX")
FIXTURE_DB="$TEMP_DIR/fixture.sqlite"
SERVER_PID=""

sql() {
  python3 - "$FIXTURE_DB" "$1" <<'PYSQL'
import sqlite3
import sys
with sqlite3.connect(sys.argv[1], timeout=30) as database:
    database.execute('PRAGMA foreign_keys=ON')
    rows = database.execute(sys.argv[2]).fetchall()
    for row in rows:
        print('\t'.join('' if value is None else str(value) for value in row))
PYSQL
}

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

command -v python3 >/dev/null 2>&1 || { echo "Python 3 with SQLite support is required." >&2; exit 1; }

# The fixture must exercise the checked-out server and migrations, not an
# older binary left in target/ from a previous release.
cargo build --locked --bin swartzit-server >/dev/null

database_url="sqlite:${FIXTURE_DB}"
DATABASE_URL="$database_url" \
  BIND_ADDR="127.0.0.1:${API_PORT}" \
  SWARTZIT_STATE_DIR="$TEMP_DIR/state" \
  SWARTZIT_DB_TELEMETRY=0 \
  target/debug/swartzit-server >"$TEMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in {1..45}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:${API_PORT}/ready" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$TEMP_DIR/server.log" >&2
    exit 1
  fi
  sleep 1
done
curl -fsS --max-time 2 "http://127.0.0.1:${API_PORT}/ready" >/dev/null

author_id=$(sql "INSERT INTO authors(handle) VALUES ('perf_fixture') RETURNING id")
small_id=$(sql "INSERT INTO communities(slug,name,description) VALUES ('perf_small','Performance 10k','Disposable benchmark fixture') RETURNING id")
large_id=$(sql "INSERT INTO communities(slug,name,description) VALUES ('perf_large','Performance 100k','Disposable benchmark fixture') RETURNING id")
sql "WITH RECURSIVE fixture(g) AS (
       SELECT 1 UNION ALL SELECT g + 1 FROM fixture WHERE g < 100000
     )
     INSERT INTO posts(community_id,author_id,title,body,moderation_status,created_at)
     SELECT CASE WHEN g <= 10000 THEN ${small_id} ELSE ${large_id} END,
            ${author_id},
            'Synthetic post ' || g,
            'Synthetic benchmark body for post ' || g,
            'approved',
            strftime('%Y-%m-%dT%H:%M:%fZ','now',(g - 100000) || ' seconds')
     FROM fixture"
sql "ANALYZE posts"
sql "ANALYZE post_stats"

echo "fixture database=${FIXTURE_DB} small_posts=10000 total_posts=100000"
echo
echo "-- 10k-post community feed plan --"
sql "EXPLAIN QUERY PLAN
     SELECT p.id, p.created_at, ps.comment_count, ps.score
     FROM posts p LEFT JOIN post_stats ps ON ps.post_id=p.id
     WHERE p.community_id=${small_id} AND p.moderation_status='approved'
     ORDER BY p.created_at DESC, p.id DESC LIMIT 20"
echo
echo "-- 100k-post public feed plan --"
sql "EXPLAIN QUERY PLAN
     SELECT p.id, p.created_at, ps.comment_count, ps.score
     FROM posts p LEFT JOIN post_stats ps ON ps.post_id=p.id
     WHERE p.moderation_status='approved'
     ORDER BY p.created_at DESC, p.id DESC LIMIT 20"
echo
echo "-- HTTP 10k-post community feed --"
node scripts/perf-smoke.mjs \
  --url "http://127.0.0.1:${API_PORT}" \
  --path "/api/posts?sort=newest&community=perf_small" \
  --requests "${SWARTZIT_PERF_REQUESTS:-100}" \
  --concurrency "${SWARTZIT_PERF_CONCURRENCY:-4}"
echo
echo "-- HTTP 100k-post public feed --"
node scripts/perf-smoke.mjs \
  --url "http://127.0.0.1:${API_PORT}" \
  --path "/api/posts?sort=newest" \
  --requests "${SWARTZIT_PERF_REQUESTS:-100}" \
  --concurrency "${SWARTZIT_PERF_CONCURRENCY:-4}"

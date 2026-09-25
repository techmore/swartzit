#!/usr/bin/env bash
# Shared helpers for the native PostgreSQL backup, restore-rehearsal, and
# release-preflight scripts. Sourced, never executed directly.
#
# Production Ubuntu runs these as root and talks to the `postgres` system user
# through runuser. A Mac rehearsal runs as the current user against a Homebrew
# cluster, so the privilege wrapper is chosen instead of hard-coded.

SWARTZIT_DB_USER=${SWARTZIT_DB_USER:-swartzit}
SWARTZIT_DB_NAME=${SWARTZIT_DB_NAME:-swartzit}
SWARTZIT_DB_HOST=${SWARTZIT_DB_HOST:-/var/run/postgresql}
SWARTZIT_DB_PORT=${SWARTZIT_DB_PORT:-}
# Empty means "run as the current user".
SWARTZIT_PG_RUN_AS=${SWARTZIT_PG_RUN_AS:-}
# The account allowed to create throwaway databases and roles. On production the
# service role is not a superuser, so the rehearsal and the dump run as the
# `postgres` OS account and the rehearsal role owns only its own copy.
SWARTZIT_PG_ADMIN_USER=${SWARTZIT_PG_ADMIN_USER:-}
SWARTZIT_PG_ADMIN_HOST=${SWARTZIT_PG_ADMIN_HOST:-}
SWARTZIT_PG_ADMIN_PORT=${SWARTZIT_PG_ADMIN_PORT:-}

swartzit_pg_resolve_run_as() {
  if [[ -z "$SWARTZIT_PG_RUN_AS" && "$(id -u)" -eq 0 ]] && id postgres >/dev/null 2>&1; then
    SWARTZIT_PG_RUN_AS=postgres
  fi
  if [[ -z "$SWARTZIT_PG_ADMIN_USER" ]]; then
    if [[ -n "$SWARTZIT_PG_RUN_AS" ]]; then
      SWARTZIT_PG_ADMIN_USER="$SWARTZIT_PG_RUN_AS"
    else
      # No privilege drop, so the admin identity is the account local
      # authentication maps to. Peer and trust both resolve to the OS user, so
      # naming the configured database role here would fail to connect.
      SWARTZIT_PG_ADMIN_USER=$(id -un)
    fi
  fi
  SWARTZIT_PG_ADMIN_HOST=${SWARTZIT_PG_ADMIN_HOST:-$SWARTZIT_DB_HOST}
  SWARTZIT_PG_ADMIN_PORT=${SWARTZIT_PG_ADMIN_PORT:-$SWARTZIT_DB_PORT}
  # A socket directory that does not exist is worse than useless: PostgreSQL
  # reports a bare "No such file or directory". Homebrew keeps its socket in
  # /tmp, so fall back to loopback when the configured path is absent.
  if [[ "$SWARTZIT_PG_ADMIN_HOST" == /* && ! -d "$SWARTZIT_PG_ADMIN_HOST" ]]; then
    SWARTZIT_PG_ADMIN_HOST=127.0.0.1
    SWARTZIT_PG_ADMIN_PORT=${SWARTZIT_PG_ADMIN_PORT:-5432}
  fi
}

swartzit_pg_privilege_wrapper() {
  local tool="$1"
  shift
  # Never let a client prompt. An unattended upgrade that blocks on
  # "Password for user postgres:" holds its lock and presents as a hang rather
  # than a failure, which is far harder to diagnose and recover from.
  if [[ -z "${PGPASSWORD+x}" ]]; then
    export PGPASSWORD=""
  fi
  export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-10}
  case "$tool" in
    psql|pg_dump|pg_restore|createdb|dropdb|dropuser)
      set -- --no-password "$@"
      ;;
  esac
  if [[ -z "$SWARTZIT_PG_RUN_AS" ]]; then
    "$tool" "$@"
    return
  fi
  case "$tool" in
    pg_*|psql|createdb|dropdb|dropuser|pgbench)
      if [[ "$(id -u)" -eq 0 ]]; then
        runuser -u "$SWARTZIT_PG_RUN_AS" -- "$tool" "$@"
      else
        sudo -n -u "$SWARTZIT_PG_RUN_AS" "$tool" "$@"
      fi
      ;;
    *)
      "$tool" "$@"
      ;;
  esac
}

swartzit_pg() {
  swartzit_pg_privilege_wrapper "$@"
}

# Administrative client call: connects as the admin role over the admin
# endpoint. No password is ever needed because the admin role authenticates as
# the OS account the wrapper already dropped to.
swartzit_pg_admin() {
  local client="$1"
  shift
  local host_args=()
  [[ -n "$SWARTZIT_PG_ADMIN_HOST" ]] && host_args+=(-h "$SWARTZIT_PG_ADMIN_HOST")
  [[ -n "$SWARTZIT_PG_ADMIN_PORT" ]] && host_args+=(-p "$SWARTZIT_PG_ADMIN_PORT")
  swartzit_pg "$client" "${host_args[@]}" -U "$SWARTZIT_PG_ADMIN_USER" "$@"
}

# Run a command as the application service account, falling back to the current
# user when the account does not exist (Mac rehearsals, developer containers).
swartzit_pg_service_account() {
  local user="$1"
  shift
  if id "$user" >/dev/null 2>&1; then
    runuser -u "$user" -- "$@"
  else
    "$@"
  fi
}

swartzit_pg_table_row_counts() {
  # Public tables other than the sqlx migration ledger, sorted for stable diffs.
  local database="$1"
  local excluded="${2:-_sqlx_migrations}"
  swartzit_pg_admin psql -d "$database" -Atq -F $'\t' -c "
    select tablename,
           (xpath('/table/row/count/text()', query_to_xml(format('select count(*) as count from %I', tablename), true, false, '')))[1]::text
      from pg_tables
     where schemaname = 'public'
       and tablename <> '$excluded'
     order by tablename"
}

# A local socket connection string that relies on peer authentication. Passwords
# never appear in process arguments or on disk.
swartzit_pg_socket_url() {
  local database="$1"
  printf 'postgres://%s@/%s' "$SWARTZIT_DB_USER" "$database"
}

swartzit_pg_random_password() {
  python3 -c 'import secrets; print(secrets.token_urlsafe(24))'
}

# Print a currently free loopback TCP port. The release preflight uses this so a
# rehearsal never collides with an unrelated service already on the host.
swartzit_pg_free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

# Echo the host, port, user, and scheme of a PostgreSQL URL, one per line. Used
# to rehearse against the same endpoint the production service uses without
# ever printing or storing the password.
swartzit_pg_url_parts() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import unquote, urlsplit
parts = urlsplit(sys.argv[1])
print(unquote(parts.scheme or 'postgres'))
print(unquote(parts.hostname or ''))
print(parts.port or 5432)
print(unquote(parts.username or ''))
PY
}

# Resolve the connection URL the production service uses. The rehearsal only
# needs its host, port, and scheme, but reading the real value keeps the
# rehearsal on the same endpoint and the same authentication method.
SWARTZIT_DATABASE_URL_FILE=${SWARTZIT_DATABASE_URL_FILE:-/etc/swartzit/server.env}
swartzit_pg_service_database_url() {
  if [[ -n "${SWARTZIT_DATABASE_URL:-}" ]]; then
    printf '%s' "$SWARTZIT_DATABASE_URL"
    return 0
  fi
  local line
  if [[ -r "$SWARTZIT_DATABASE_URL_FILE" ]]; then
    line=$(grep -m1 -E '^[[:space:]]*DATABASE_URL=' "$SWARTZIT_DATABASE_URL_FILE" || true)
    if [[ -n "$line" ]]; then
      line=${line#*=}
      line=${line%\"}
      line=${line#\"}
      line=${line%\'}
      line=${line#\'}
      printf '%s' "$line"
      return 0
    fi
  fi
  return 1
}

# Run a client as a specific role with a throwaway password supplied through the
# environment rather than the command line, so it never shows up in `ps`.
swartzit_pg_as_role() {
  local role="$1" password="$2" host="$3" port="$4" database="$5"
  shift 5
  PGPASSWORD="$password" "$@" --no-password -h "$host" -p "$port" -U "$role" -d "$database"
}

# Endpoint for a disposable rehearsal role.
#
# A disposable role can only authenticate with its password, and a unix socket
# connection is governed by peer authentication, which maps the invoking OS
# account instead. When the configured host is a socket directory, connect to
# loopback over TCP so the generated password is actually used.
swartzit_pg_role_endpoint() {
  local host="${1:-}" port="${2:-}"
  if [[ -z "$host" || "$host" == /* ]]; then
    printf '127.0.0.1 %s\n' "${port:-5432}"
  else
    printf '%s %s\n' "$host" "${port:-5432}"
  fi
}

# Tear down a disposable rehearsal database and its role.
#
# A candidate server that fails mid-startup can leave a session attached, and
# PostgreSQL refuses to drop a database that is still in use, so backends are
# terminated and the drops are retried before giving up with a warning.
swartzit_pg_drop_rehearsal() {
  local database="$1" role="$2" attempt dropped_db=0 dropped_role=0
  for attempt in 1 2 3 4 5; do
    swartzit_pg_admin psql -d postgres -q -c \
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$database' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
    if swartzit_pg_admin dropdb --if-exists "$database" >/dev/null 2>&1; then dropped_db=1; fi
    if swartzit_pg_admin dropuser --if-exists "$role" >/dev/null 2>&1; then dropped_role=1; fi
    if ((dropped_db == 1 && dropped_role == 1)); then
      return 0
    fi
    sleep 1
  done
  echo "Warning: rehearsal database $database or role $role could not be fully removed." >&2
  return 1
}

# Tables that keep changing while a live instance is running.
#
# The backup manifest is collected after pg_dump has taken its snapshot, so a
# table that is written continuously can legitimately hold a different number
# of rows by then. Comparing those tables for equality produces false failures;
# comparing content tables strictly is the check that actually proves the
# restore is faithful.
SWARTZIT_VOLATILE_TABLES=${SWARTZIT_VOLATILE_TABLES:-sessions system_logs ip_activity ip_blocks post_view_visits crawler_runs content_runner_runs media_replication_jobs}

# Compare a backup manifest against restored row counts.
#
# Content tables must match exactly. Volatile tables are reported with their
# delta but do not fail the rehearsal. A table present in one side and not the
# other always fails, because that means the restore is structurally wrong.
swartzit_pg_compare_row_counts() {
  local manifest="$1" restored="$2"
  awk -v volatile="$SWARTZIT_VOLATILE_TABLES" '
    BEGIN {
      count = split(volatile, list, " ")
      for (i = 1; i <= count; i++) if (list[i] != "") isVolatile[list[i]] = 1
    }
    FNR == NR { manifest[$1] = $2; next }
    {
      name = $1
      got = $2
      if (!(name in manifest)) {
        printf("  FAIL  %s exists after restore but not in the manifest\n", name)
        bad = 1
        next
      }
      if (manifest[name] != got) {
        if (name in isVolatile) {
          printf("  note  %s is expected to move: manifest %s, restored %s\n", name, manifest[name], got)
        } else {
          printf("  FAIL  %s manifest %s, restored %s\n", name, manifest[name], got)
          bad = 1
        }
      }
      seen[name] = 1
    }
    END {
      for (name in manifest) {
        if (!(name in seen)) {
          printf("  FAIL  %s is in the manifest but missing after restore\n", name)
          bad = 1
        }
      }
      exit bad
    }
  ' "$manifest" "$restored"
}

swartzit_pg_require_tools() {
  local missing=()
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if ((${#missing[@]})); then
    echo "Missing required PostgreSQL tools: ${missing[*]}" >&2
    return 1
  fi
}

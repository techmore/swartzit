#!/usr/bin/env bash
set -euo pipefail
SCRIPT_HOME=$(cd "$(dirname "$0")" && pwd)
# Unified verifier supports SQLite and retained PostgreSQL backups.
exec bash "$SCRIPT_HOME/db-restore-verify-postgres.sh" "$@"

#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

REMOTE="${SWARTZIT_GITHUB_BACKUP_REMOTE:-}"
BRANCH="${SWARTZIT_GITHUB_BACKUP_BRANCH:-main}"
RETENTION_DAYS="${SWARTZIT_GITHUB_BACKUP_RETENTION_DAYS:-14}"
ALLOW_SHRINK="${SWARTZIT_GITHUB_BACKUP_ALLOW_SHRINK:-0}"
STATE_DIR="${STATE_DIRECTORY:-/var/lib/swartzit-github-backup}"
BACKUP_ROOT="${SWARTZIT_GITHUB_BACKUP_LOCAL_DIR:-$STATE_DIR/local-backups}"
SSH_DIR="$STATE_DIR/ssh"
SSH_KEY="$SSH_DIR/github-deploy-key"
KNOWN_HOSTS="$SSH_DIR/known_hosts"

die() {
  echo "GitHub database backup: $*" >&2
  exit 1
}

[[ -n "$REMOTE" ]] || die 'set SWARTZIT_GITHUB_BACKUP_REMOTE to a private GitHub backup repository.'
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || die 'SWARTZIT_GITHUB_BACKUP_RETENTION_DAYS must be a positive integer.'
[[ "$ALLOW_SHRINK" == 0 || "$ALLOW_SHRINK" == 1 ]] || die 'SWARTZIT_GITHUB_BACKUP_ALLOW_SHRINK must be 0 or 1.'
git check-ref-format "refs/heads/$BRANCH" >/dev/null || die "invalid Git branch name: $BRANCH"
case "$REMOTE" in
  git@github.com:*|ssh://git@github.com/*) ;;
  *) die 'use an SSH remote such as git@github.com:OWNER/REPOSITORY.git.' ;;
esac

for command_name in git sha256sum awk date ssh flock python3; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
done
[[ -f "$ROOT/scripts/db-backup.sh" ]] || die 'scripts/db-backup.sh was not found.'
[[ -s "$SSH_KEY" ]] || die "SSH deploy key not found: $SSH_KEY"
[[ -s "$KNOWN_HOSTS" ]] || die "GitHub host keys not found: $KNOWN_HOSTS"

export GIT_SSH_COMMAND="ssh -F /dev/null -i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KNOWN_HOSTS"

mkdir -p "$STATE_DIR" "$BACKUP_ROOT"
umask 0077
LOCK_FILE="$STATE_DIR/.github-backup.lockfile"
exec {LOCK_FD}>"$LOCK_FILE" || die "could not open backup lock file: $LOCK_FILE"
flock -n "$LOCK_FD" || die 'another GitHub database backup is already running.'
WORK_DIR=""
cleanup() {
  if [[ -n "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT
WORK_DIR=$(mktemp -d "$STATE_DIR/git-work.XXXXXXXX")

dump_format() {
  # PostgreSQL headers contain NUL bytes; shell substitutions must only carry
  # the text label, never binary header data.
  python3 - "$1" <<'PY_FORMAT'
import sys
with open(sys.argv[1], 'rb') as source:
    header = source.read(16)
print('sqlite' if header == b'SQLite format 3\x00' else 'postgres' if header.startswith(b'PGDMP') else 'unknown')
PY_FORMAT
}

validate_dump() {
  local dump="$1"
  local format verification_dir
  format=$(dump_format "$dump")
  if [[ "$format" == sqlite ]]; then
    # Frozen backup files are complete snapshots. Verify a private copy so
    # reading a legacy WAL-mode header cannot create files in the Git tree.
    verification_dir=$(mktemp -d "$WORK_DIR/sqlite-verify.XXXXXXXX")
    cp "$dump" "$verification_dir/snapshot.sqlite"
    python3 "$ROOT/scripts/sqlite-db.py" verify "$verification_dir/snapshot.sqlite" "$(dirname "$dump")/row-counts.tsv" >/dev/null
    rm -rf -- "$verification_dir"
  elif [[ "$format" == postgres ]] && command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$dump" >/dev/null
  else
    # Historical PG snapshots remain checksum-protected and restorable with
    # PostgreSQL client tools. New runtime backups are checked as SQLite.
    [[ "$format" == postgres ]]
  fi
}

TODAY=$(date -u '+%F')
CREATED_UTC=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

BACKUP_OUTPUT=$( \
  SWARTZIT_BACKUP_DIR="$BACKUP_ROOT" \
  SWARTZIT_BACKUP_RETENTION="$RETENTION_DAYS" \
  SWARTZIT_DB_BACKUP_INCLUDE_MEDIA=0 \
  bash "$ROOT/scripts/db-backup.sh"
)
printf '%s\n' "$BACKUP_OUTPUT"
ARCHIVE=$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Archive: //p' | tail -n 1)
[[ -n "$ARCHIVE" ]] || die 'database backup did not report its archive path.'
ARCHIVE_NAME=${ARCHIVE##*/}
[[ "$ARCHIVE_NAME" =~ ^swartzit-([0-9]{8}T[0-9]{6}Z)-backup\.tgz$ ]] || die "unexpected archive name: $ARCHIVE_NAME"
NEW_LOCAL_DIR="$BACKUP_ROOT/${BASH_REMATCH[1]}"
DUMP="$NEW_LOCAL_DIR/swartzit.dump"
COUNTS="$NEW_LOCAL_DIR/row-counts.tsv"
[[ -s "$DUMP" ]] || die 'database dump is missing or empty.'
[[ -s "$COUNTS" ]] || die 'database row-count file is missing or empty.'
validate_dump "$DUMP" || die 'could not read the new database snapshot.'

dump_sha() {
  sha256sum "$1" | awk '{print $1}'
}

dump_bytes() {
  wc -c < "$1" | awk '{print $1}'
}

row_total() {
  awk -F '\t' '
    NF != 2 || $1 == "" || $2 !~ /^[0-9]+$/ { invalid = 1; next }
    { total += $2; seen = 1 }
    END {
      if (invalid || !seen) exit 1
      printf "%.0f\n", total
    }
  ' "$1"
}

compare_row_counts() {
  python3 "$ROOT/scripts/compare-backup-counts.py" "$1" "$2"
}

NEW_SHA=$(dump_sha "$DUMP")
NEW_BYTES=$(dump_bytes "$DUMP")
NEW_ROWS=$(row_total "$COUNTS") || die 'new row-count file is malformed.'

git init --quiet --initial-branch="$BRANCH" "$WORK_DIR"
git -C "$WORK_DIR" remote add origin "$REMOTE"
REMOTE_REFS=$(git ls-remote --heads "$REMOTE" "refs/heads/$BRANCH") || die 'could not read the backup branch from GitHub.'
REMOTE_HEAD=$(printf '%s\n' "$REMOTE_REFS" | awk 'NR == 1 { print $1 }')
if [[ -n "$REMOTE_HEAD" ]]; then
  git -C "$WORK_DIR" fetch --quiet --depth=1 origin "refs/heads/$BRANCH" || die 'could not fetch the existing backup branch.'
  FETCHED_HEAD=$(git -C "$WORK_DIR" rev-parse FETCH_HEAD)
  [[ "$FETCHED_HEAD" == "$REMOTE_HEAD" ]] || die 'backup branch changed during fetch; retry the backup.'
  git -C "$WORK_DIR" reset --quiet --hard FETCH_HEAD

  while IFS= read -r tracked_path; do
    [[ "$tracked_path" == snapshots/* ]] || die "backup branch contains an unexpected path: $tracked_path"
  done < <(git -C "$WORK_DIR" ls-tree -r --name-only HEAD)
fi

shopt -s nullglob
LATEST_SNAPSHOT=""
for snapshot_dir in "$WORK_DIR"/snapshots/*; do
  [[ -d "$snapshot_dir" && ! -L "$snapshot_dir" ]] || die "unexpected entry in backup branch: ${snapshot_dir##*/}"
  snapshot_date=${snapshot_dir##*/}
  [[ "$snapshot_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "invalid snapshot date: $snapshot_date"
  # The initial SQLite backup verifier could leave empty WAL/SHM metadata in
  # its temporary checkout. Repair only that known case, after proving the
  # standalone database matches its saved counts. A WAL with data is rejected.
  if [[ -e "$snapshot_dir/swartzit.dump-wal" || -L "$snapshot_dir/swartzit.dump-wal" || -e "$snapshot_dir/swartzit.dump-shm" || -L "$snapshot_dir/swartzit.dump-shm" ]]; then
    [[ "$(dump_format "$snapshot_dir/swartzit.dump")" == sqlite ]] || die 'sidecar files accompany a non-SQLite snapshot.'
    for sidecar in "$snapshot_dir/swartzit.dump-wal" "$snapshot_dir/swartzit.dump-shm"; do
      [[ ! -L "$sidecar" && ( ! -e "$sidecar" || -f "$sidecar" ) ]] || die 'unsafe SQLite snapshot sidecar.'
    done
    [[ ! -s "$snapshot_dir/swartzit.dump-wal" ]] || die 'a frozen snapshot contains a nonempty WAL; refusing to discard data.'
    validate_dump "$snapshot_dir/swartzit.dump" || die 'standalone SQLite snapshot did not match its manifest.'
    rm -f -- "$snapshot_dir/swartzit.dump-wal" "$snapshot_dir/swartzit.dump-shm"
  fi
  for snapshot_file in "$snapshot_dir"/*; do
    case "${snapshot_file##*/}" in
      SHA256SUMS|manifest.tsv|row-counts.tsv|source-row-counts.tsv|swartzit.dump) ;;
      *) die "unexpected backup file: ${snapshot_file#"$WORK_DIR"/}" ;;
    esac
    [[ -f "$snapshot_file" && ! -L "$snapshot_file" && -s "$snapshot_file" ]] || die "missing, empty, or unsafe backup file: $snapshot_file"
  done
  for required_file in SHA256SUMS manifest.tsv row-counts.tsv source-row-counts.tsv swartzit.dump; do
    [[ -s "$snapshot_dir/$required_file" ]] || die "incomplete existing snapshot: ${snapshot_dir#"$WORK_DIR"/}"
  done
  (cd "$snapshot_dir" && sha256sum --check --status SHA256SUMS) || die "checksum failed for ${snapshot_dir#"$WORK_DIR"/}"
  validate_dump "$snapshot_dir/swartzit.dump" || die "could not validate ${snapshot_dir#"$WORK_DIR"/}"
  row_total "$snapshot_dir/row-counts.tsv" >/dev/null || die "invalid row counts in ${snapshot_dir#"$WORK_DIR"/}"
  if [[ -z "$LATEST_SNAPSHOT" || "$snapshot_date" > "${LATEST_SNAPSHOT##*/}" ]]; then
    LATEST_SNAPSHOT="$snapshot_dir"
  fi
done

if [[ -n "$LATEST_SNAPSHOT" ]]; then
  PREVIOUS_SHA=$(dump_sha "$LATEST_SNAPSHOT/swartzit.dump")
  PREVIOUS_BYTES=$(dump_bytes "$LATEST_SNAPSHOT/swartzit.dump")
  SHRINK_REASONS=()
  if (( NEW_BYTES < PREVIOUS_BYTES )); then
    echo "Dump size decreased from $PREVIOUS_BYTES to $NEW_BYTES bytes; validating table row counts (expiry and compression can change dump size)."
  fi
  if compare_row_counts "$LATEST_SNAPSHOT/row-counts.tsv" "$COUNTS"; then
    :
  else
    compare_status=$?
    if (( compare_status == 1 )); then
      SHRINK_REASONS+=("one or more durable table row counts decreased, or a table disappeared")
    else
      die 'could not compare the current and previous row counts.'
    fi
  fi
  if (( ${#SHRINK_REASONS[@]} > 0 )); then
    if [[ "$ALLOW_SHRINK" == 1 ]]; then
      printf 'WARNING: explicitly allowing a smaller backup: %s\n' "${SHRINK_REASONS[*]}" >&2
    else
      printf 'GitHub database backup: refusing to publish because %s. Inspect the database; set SWARTZIT_GITHUB_BACKUP_ALLOW_SHRINK=1 for a deliberate shrink.\n' "${SHRINK_REASONS[*]}" >&2
      exit 1
    fi
  fi
  if [[ "$NEW_SHA" == "$PREVIOUS_SHA" ]]; then
    echo 'Dump checksum matches the previous snapshot; recording today’s verified backup.'
  else
    echo "Dump checksum changed: $NEW_ROWS public rows, $NEW_BYTES bytes."
  fi
else
  echo "First verified snapshot: $NEW_ROWS public rows, $NEW_BYTES bytes."
fi

SNAPSHOT_DIR="$WORK_DIR/snapshots/$TODAY"
mkdir -p "$SNAPSHOT_DIR"
install -m 0600 "$DUMP" "$SNAPSHOT_DIR/swartzit.dump"
install -m 0600 "$COUNTS" "$SNAPSHOT_DIR/row-counts.tsv"
install -m 0600 "$COUNTS" "$SNAPSHOT_DIR/source-row-counts.tsv"
printf '%s  swartzit.dump\n' "$NEW_SHA" > "$SNAPSHOT_DIR/SHA256SUMS"
{
  printf 'database_format\tsqlite-or-legacy-postgres\n'
  printf 'created_utc\t%s\n' "$CREATED_UTC"
  printf 'database_rows\t%s\n' "$NEW_ROWS"
  printf 'dump_bytes\t%s\n' "$NEW_BYTES"
  printf 'dump_sha256\t%s\n' "$NEW_SHA"
} > "$SNAPSHOT_DIR/manifest.tsv"
(cd "$SNAPSHOT_DIR" && sha256sum --check --status SHA256SUMS) || die 'copied dump failed its checksum.'
validate_dump "$SNAPSHOT_DIR/swartzit.dump" || die 'copied dump failed validation.'
row_total "$SNAPSHOT_DIR/source-row-counts.tsv" >/dev/null || die 'copied row counts failed validation.'

CUTOFF=$(date -u -d "$((RETENTION_DAYS - 1)) days ago" '+%F') || die 'could not calculate the snapshot retention cutoff.'
for snapshot_dir in "$WORK_DIR"/snapshots/*; do
  [[ -d "$snapshot_dir" ]] || continue
  snapshot_date=${snapshot_dir##*/}
  if [[ "$snapshot_date" < "$CUTOFF" ]]; then
    rm -rf -- "$snapshot_dir"
  fi
done

git -C "$WORK_DIR" add --all -- snapshots
TREE=$(git -C "$WORK_DIR" write-tree)
NEW_COMMIT=$(printf 'Swartzit database backup %s\n' "$TODAY" | \
  git -C "$WORK_DIR" -c user.name='Swartzit backup' -c user.email='swartzit-backup@localhost' commit-tree "$TREE")
git -C "$WORK_DIR" push --quiet \
  --force-with-lease="refs/heads/$BRANCH:$REMOTE_HEAD" \
  origin "$NEW_COMMIT:refs/heads/$BRANCH" || die 'push failed; the GitHub backup branch was not updated.'

echo "Published snapshots from $CUTOFF through $TODAY to $REMOTE (branch $BRANCH)."

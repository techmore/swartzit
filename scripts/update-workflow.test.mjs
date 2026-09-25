import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

// The Linux entry point is a thin wrapper: the gates live in the release
// updater it delegates to, so these assertions follow the behaviour rather than
// a particular implementation layout.
test('Linux updater gates the update on a backup, a rehearsal, and health checks', () => {
  const entry = read('scripts/swartzit-linux-update.sh');
  const updater = read('scripts/swartzit-release-update.sh');

  // The entry point carries no update logic of its own.
  assert.match(entry, /RELEASE_UPDATER="\$SCRIPT_HOME\/swartzit-release-update\.sh"/);
  assert.match(entry, /bash "\$RELEASE_UPDATER"/);

  // Backup with the service credentials, then proved restorable.
  assert.match(updater, /SWARTZIT_DB_BACKUP_MODE=native/);
  assert.match(updater, /db-backup\.sh/);
  assert.match(updater, /db-restore-verify-postgres\.sh/);

  // The candidate release must migrate a restored copy before anything stops.
  assert.match(updater, /preflight-release\.sh/);

  // Only checksum-verified release assets are installed.
  assert.match(updater, /sha256sum -c SHA256SUMS/);

  // The health gate covers readiness, database health, and the web build.
  assert.match(updater, /\/ready/);
  assert.match(updater, /\/health/);

  // Rollback restores the previous commit instead of discarding history.
  assert.match(updater, /checkout --detach "\$PREVIOUS_COMMIT"/);
  assert.doesNotMatch(updater, /git .*reset --hard/);
});

test('Linux updater requires confirmation and preserves operator files', () => {
  const entry = read('scripts/swartzit-linux-update.sh');
  const updater = read('scripts/swartzit-release-update.sh');

  // An unattended deploy passes --yes; an interactive run must confirm the tag.
  assert.match(entry, /--yes/);
  assert.match(entry, /Usage: \$0 --tag/);
  assert.match(updater, /Type the tag to continue/);

  // Operator-owned environment files are read, never rewritten.
  assert.match(updater, /SERVICE_ENV_FILE=.*server\.env/);
  assert.doesNotMatch(updater, /cat\s+>\s*"?\$SERVICE_ENV_FILE/);
});

test('the checkout gate ignores untracked operational state', () => {
  // The deployment directory holds untracked state by design (state/, caches,
  // dotfiles). Blocking on it would make the host unupgradeable.
  const updater = read('scripts/swartzit-release-update.sh');
  assert.match(updater, /"\$\{GIT\[@\]\}" diff --quiet/);
});

test('database backup supports native PostgreSQL and keeps container mode', () => {
  const backup = read('scripts/db-backup.sh');
  assert.match(backup, /DB_MODE=.*SWARTZIT_DB_BACKUP_MODE/);
  assert.match(backup, /pg_dump --dbname="\$DATABASE_URL"/);
  assert.match(backup, /container exec "\$CONTAINER" pg_dump/);
  assert.match(backup, /Database: \$DB_BACKEND/);
});

test('macOS updates verify the backup before Homebrew changes the package', () => {
  const updater = read('scripts/swartzit-update.sh');
  assert.match(updater, /VERIFY_BACKUP=.*SWARTZIT_VERIFY_BACKUP/);
  assert.match(updater, /db-restore-verify\.sh/);
  assert.match(updater, /verify-backup/);
});

test('production deployment is opt-in, tag-triggered, and serialized', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /vars\.SWARTZIT_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /SWARTZIT_DEPLOY_KNOWN_HOSTS/);
  // A merge to main must not change a live host; only a published tag deploys.
  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/);
  assert.doesNotMatch(workflow, /branches: \[main\]/);
  // The deploy names the tag it is installing.
  assert.match(workflow, /swartzit-linux-update\.sh --tag \$RELEASE_TAG --yes/);
});

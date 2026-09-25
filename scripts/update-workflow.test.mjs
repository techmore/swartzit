import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

test('Linux updater gates the update on a native backup and health checks', () => {
  const updater = read('scripts/swartzit-linux-update.sh');
  assert.match(updater, /SWARTZIT_DB_BACKUP_MODE=native/);
  assert.match(updater, /sha256sum -c SHA256SUMS/);
  assert.match(updater, /pg_restore --list/);
  assert.match(updater, /wait_for_health/);
  assert.match(updater, /git -C "\$APP_DIR" switch --detach "\$PREVIOUS_COMMIT"/);
  assert.doesNotMatch(updater, /git .*reset --hard/);
});

test('Linux updater preserves operator-owned environment files', () => {
  const updater = read('scripts/swartzit-linux-update.sh');
  assert.match(updater, /SERVER_ENV_FILE=.*server\.env/);
  assert.match(updater, /WEB_ENV_FILE=.*web\.env/);
  assert.doesNotMatch(updater, /cat\s+>\s*"?\$SERVER_ENV_FILE/);
  assert.doesNotMatch(updater, /cat\s+>\s*"?\$WEB_ENV_FILE/);
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

test('production deployment is opt-in and serializes updates', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /vars\.SWARTZIT_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /swartzit-linux-update\.sh --yes/);
  assert.match(workflow, /SWARTZIT_DEPLOY_KNOWN_HOSTS/);
});

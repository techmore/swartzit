import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  assert.match(updater, /WEB_URL=\$\{SWARTZIT_WEB_URL:-http:\/\/192\.168\.3\.251:4173\}/);

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

test('the release updater references only variables it defines', () => {
  // `set -u` turns a single undefined reference into an upgrade that dies
  // partway through, so every ${VAR} must be a parameter default, a local, or
  // assigned before use.
  const updater = read('scripts/swartzit-release-update.sh');
  const assigned = new Set();
  for (const match of updater.matchAll(/^\s*(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)=/gm)) {
    assigned.add(match[1]);
  }
  for (const match of updater.matchAll(/for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in/g)) {
    assigned.add(match[1]);
  }
  // `read -r -p prompt NAME` assigns NAME.
  for (const line of updater.split('\n')) {
    if (!/\bread\b/.test(line)) continue;
    for (const match of line.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
      assigned.add(match[1]);
    }
  }
  for (const match of updater.matchAll(/\b([A-Z][A-Z0-9_]{2,})=["']?/g)) {
    assigned.add(match[1]);
  }
  const ambient = new Set(['PATH', 'HOME', 'HOSTNAME', 'PWD', 'USER', 'TMPDIR', 'SHLVL', 'IFS', 'BASH', 'UID', 'EUID', 'RANDOM', 'SECONDS', 'LINENO', 'PS1', 'PS2', 'OPTARG', 'OSTYPE', 'MACHTYPE', 'HOSTTYPE']);
  for (const match of updater.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)) {
    const name = match[1];
    // ${NAME:-default} and ${NAME:=default} read an optional environment
  // override, which is a defined read rather than an undefined variable.
  const overrides = new Set(
    [...updater.matchAll(/\$\{([A-Z][A-Z0-9_]{2,}):[-=]/g)].map((match) => match[1]),
  );
  if (ambient.has(name) || overrides.has(name)) continue;
    assert.ok(assigned.has(name), `release updater uses $${name} without assigning it`);
  }
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
  // A merge to main must not change a live host; only a published tag deploys.
  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/);
  assert.doesNotMatch(workflow, /branches: \[main\]/);
  // The deploy names the tag it is installing.
  assert.match(workflow, /swartzit-linux-update\.sh --tag "\$TAG" --yes/);
});

test('the deploy runs on a self-hosted runner with no remote access', () => {
  // The public address is CGNAT and only 80/443 are forwarded, so a
  // GitHub-hosted runner can never SSH in. The runner therefore lives on the
  // host, which removes the deploy key, known_hosts, and any inbound port.
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /runs-on: \[self-hosted, swartzit, production\]/);
  assert.match(workflow, /environment: production/);
  assert.doesNotMatch(workflow, /SWARTZIT_DEPLOY_HOST/);
  assert.doesNotMatch(workflow, /SWARTZIT_DEPLOY_SSH_KEY/);
  assert.doesNotMatch(workflow, /SWARTZIT_DEPLOY_KNOWN_HOSTS/);
  assert.doesNotMatch(workflow, /ssh -p/);
  // The installer is the copy already on the host, so a release cannot rewrite
  // the code that installs it.
  assert.match(workflow, /sudo -n \/var\/lib\/swartzit\/scripts\/swartzit-linux-update\.sh/);
  // release.yml runs concurrently, so the deploy waits for the assets.
  assert.match(workflow, /Wait for the release assets to be published/);
  assert.match(workflow, /releases\/tags\/\$TAG/);
  // A failure still surfaces the receipt.
  assert.match(workflow, /if: always\(\)/);
});

test('an unattended deploy only installs the tag the operator pinned', () => {
  // A tag push is unattended, so it must fail closed unless the repository
  // variable names that exact tag. Otherwise any new tag would deploy.
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /vars\.SWARTZIT_DEPLOY_TAG/);
  assert.match(workflow, /if: \$\{\{ github\.event_name == 'push' \}\}/);
  assert.match(workflow, /is not the approved deployment tag/);
  assert.match(workflow, /No approved deployment tag is pinned/);
});

test('production X token sync runs only for an explicit token-only dispatch', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  const installer = workflow.indexOf('name: Install the release on this host');
  const tokenSync = workflow.indexOf('name: Update the production worker X API token');
  assert.ok(installer >= 0 && tokenSync > installer);
  assert.match(workflow, /if: \$\{\{ success\(\) && github\.event_name == 'workflow_dispatch' && inputs\.operation == 'sync-x-token' \}\}/);
  assert.match(workflow, /X_BEARER_TOKEN: \$\{\{ secrets\.X_BEARER_TOKEN \}\}/);
  assert.match(workflow, /sync-x-token/);
  assert.match(workflow, /test-x-token/);
  assert.doesNotMatch(workflow, /steps\.install-release\.outcome == 'success'/);
  assert.match(workflow, /printf '%s' "\$X_BEARER_TOKEN" \\\n\s*\| sudo -n \/var\/lib\/swartzit\/scripts\/swartzit-linux-update\.sh --sync-x-token-stdin/);
  assert.doesNotMatch(workflow, /--(?:token|x-token) "\$X_BEARER_TOKEN"/);

  const updater = read('scripts/swartzit-linux-update.sh');
  assert.match(updater, /--sync-x-token-stdin/);
  assert.match(updater, /exec python3 "\$TOKEN_UPDATER"/);
});

test('the SER8 token probe is read-only and uses the X profile and timeline endpoints', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /runs-on: \[self-hosted, swartzit, production\]/);
  assert.match(workflow, /Test X API access from SER8/);
  assert.match(workflow, /api\.x\.com\/2\/users\/by\/username\/DarioAmodei/);
  assert.ok(workflow.includes("f'https://api.x.com/2/users/{user_id}/tweets?{query}'"));
  assert.match(workflow, /summarize_http_error/);
  assert.match(workflow, /error\.read\(\)/);
  assert.doesNotMatch(workflow, /Test X API access from SER8[\s\S]*?POST/);
});

test('worker X token updater preserves settings, replaces duplicates, and locks permissions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swartzit-x-token-'));
  const envFile = path.join(directory, 'worker.env');
  const helper = new URL('../scripts/update-worker-x-token.py', import.meta.url);
  const newToken = 'sample%2Fencoded%3Dtoken/with+safe.chars';
  try {
    fs.writeFileSync(envFile, [
      'API_URL=http://127.0.0.1:18080',
      'SCHEDULER_HANDLE=admin',
      'SCHEDULER_PASSWORD=keep-this',
      'X_BEARER_TOKEN=old-token',
      'X_BEARER_TOKEN=duplicate-token',
      '# preserve comments',
      '',
    ].join('\n'), { mode: 0o600 });

    const result = spawnSync('python3', [helper.pathname, '--file', envFile], {
      encoding: 'utf8',
      input: newToken,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(newToken));
    const contents = fs.readFileSync(envFile, 'utf8');
    assert.match(contents, /^API_URL=http:\/\/127\.0\.0\.1:18080$/m);
    assert.match(contents, /^SCHEDULER_HANDLE=admin$/m);
    assert.match(contents, /^SCHEDULER_PASSWORD=keep-this$/m);
    assert.deepEqual(contents.split('\n').filter((line) => line.startsWith('X_BEARER_TOKEN=')), [
      `X_BEARER_TOKEN=${newToken}`,
    ]);
    assert.match(contents, /^# preserve comments$/m);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('worker X token updater rejects multiline input without modifying the env file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swartzit-x-token-invalid-'));
  const envFile = path.join(directory, 'worker.env');
  const helper = new URL('../scripts/update-worker-x-token.py', import.meta.url);
  const before = 'API_URL=http://example.invalid\nX_BEARER_TOKEN=old-value\n';
  try {
    fs.writeFileSync(envFile, before, { mode: 0o600 });
    const result = spawnSync('python3', [helper.pathname, '--file', envFile], {
      encoding: 'utf8',
      input: 'first-line\nsecond-line',
    });
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(envFile, 'utf8'), before);
    assert.doesNotMatch(result.stderr, /first-line|second-line/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('worker X token updater creates a mode-600 file only when asked', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swartzit-x-token-create-'));
  const envFile = path.join(directory, 'new-worker.env');
  const helper = new URL('../scripts/update-worker-x-token.py', import.meta.url);
  try {
    const missing = spawnSync('python3', [helper.pathname, '--file', envFile], {
      encoding: 'utf8',
      input: 'valid-token',
    });
    assert.equal(missing.status, 1);
    assert.equal(fs.existsSync(envFile), false);

    const created = spawnSync('python3', [helper.pathname, '--file', envFile, '--create'], {
      encoding: 'utf8',
      input: 'valid-token',
    });
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(fs.readFileSync(envFile, 'utf8').trim().split('\n'), [
      'X_BEARER_TOKEN=valid-token',
    ]);
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

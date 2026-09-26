# Prototype, backup, and production updates

Swartzit uses the Mac as the change-and-recovery environment and the Ubuntu
host as the always-on production environment. A production update is allowed
to change the application checkout and compiled assets, but it must not rewrite
`/etc/swartzit/server.env` or `/etc/swartzit/web.env`; that keeps the deployment
bind, WireGuard address, database URL, and origin operator-owned.

## 1. Prototype on the Mac or in an Apple VM

Use the Mac checkout, an Incus macOS/Linux VM, or another disposable runtime
that has the same PostgreSQL and Node versions as production. The VM should
mount its own persistent state directory; never mount the live production
database directory into a prototype.

Before testing an upgrade, make a real backup and verify that it can be
restored into a disposable database container:

```sh
swartzit backup
swartzit restore-verify \
  "$HOME/Library/Application Support/Swartzit/backups/<timestamp>/swartzit-<timestamp>-backup.tgz"
```

Then run the local checks and upgrade path:

```sh
scripts/release-preflight.sh
swartzit update --yes
swartzit status --json
```

`swartzit update --yes` now verifies the backup archive before stopping the
local services. Set `SWARTZIT_VERIFY_BACKUP=0` only for a deliberately faster
disposable test where the backup was already verified separately.

The native macOS menu companion consumes the update receipt and status file.
It reports backup, install, health-check, and failure phases without storing
application data. Set `SWARTZIT_UPDATE_ERROR_URL` (and, when required,
`SWARTZIT_UPDATE_ERROR_TOKEN`) to send an opt-in JSON failure notification to
an operator-owned endpoint. No telemetry endpoint is enabled by default.

## 2. Commit and push the tested release

Keep the normal review boundary between the prototype and production:

```sh
git switch -c codex/your-change
git diff --check
git status --short
git add .
git commit -m "Describe the tested change"
git push -u origin codex/your-change
```

Merge to `main` only after CI and the disposable restore check pass. Merging
does **not** change a live host. Promotion is a separate, explicit step: cut a
release tag, and the deploy workflow installs that published release.

```sh
git tag -a v0.1.36-20260925T19 -m "Swartzit 0.1.36-20260925T19"
git push origin v0.1.36-20260925T19
```

`release.yml` builds and publishes the checksummed assets for the tag, and
`deploy-production.yml` then installs them on the host. A tag can also be
deployed by hand with `workflow_dispatch` and the `tag` input.

## 3. Opt the Ubuntu host into production deploys

The repository includes a guarded GitHub Actions workflow at
`.github/workflows/deploy-production.yml`. It does nothing until the repository
variable `SWARTZIT_DEPLOY_ENABLED=true` is set.

### Why the runner lives on the host

The original design deployed over SSH from a GitHub-hosted runner. That cannot
work here: the public address is CGNAT and only ports 80 and 443 are forwarded,
so an external runner cannot reach port 22 at all. Verified against four
external probes, all of which time out.

The deploy therefore runs on a self-hosted runner **on the production host
itself**, and the deploy step is a single local command:

```yaml
- run: sudo -n /var/lib/swartzit/scripts/swartzit-linux-update.sh --tag "$TAG" --yes
```

That removes the deploy private key, the pinned `known_hosts`, the deploy
secrets, and any inbound port. There is nothing to reach and no credential to
rotate.

### Runner setup

The runner runs as an unprivileged `swartzit-deploy` account. It reaches root
through exactly one sudoers grant:

```text
swartzit-deploy ALL=(root) NOPASSWD: /var/lib/swartzit/scripts/swartzit-linux-update.sh, /bin/cat /var/lib/swartzit/state/update-receipt.json
```

```sh
sudo useradd --system --create-home --home-dir /home/swartzit-deploy \
  --shell /bin/bash swartzit-deploy
sudo install -d -o swartzit-deploy -g swartzit-deploy /opt/actions-runner
# Unpack actions-runner-linux-x64-<version>.tar.gz into /opt/actions-runner,
# then as that account:
sudo -u swartzit-deploy -H ./config.sh --unattended \
  --name ser8-swartzit-deploy --labels swartzit,production \
  --url https://github.com/techmore/swartzit --token "$REGISTRATION_TOKEN" \
  --work _work --disableupdate
sudo -u swartzit-deploy -H ./svc.sh install swartzit-deploy
sudo -u swartzit-deploy -H ./svc.sh start
```

`--disableupdate` stops a release from pushing a new runner binary. Update the
runner deliberately, out of band.

The runner executes workflow code on the production host. Require a reviewer on
the `production` environment so no tag deploys unattended, and leave
`SWARTZIT_DEPLOY_ENABLED` unset until a manual run has succeeded.

The deploy step deliberately runs the installer copy that already lives at
`/var/lib/swartzit/scripts`, not the copy in the workflow checkout, so a release
cannot rewrite the code that installs it.

Because `release.yml` and this workflow both trigger on the tag push, the deploy
waits for the release assets to appear before installing anything.


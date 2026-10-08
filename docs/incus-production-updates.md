# SER8 Incus production updates

The live application and worker run in the `swartzit` Incus instance. PostgreSQL
runs separately in `swartzit-db`. The checkout, services, and receipts under
`/var/lib/swartzit` on the SER8 host are not the live application deployment.

The production workflow invokes the root-owned host entry point
`/usr/local/sbin/swartzit-incus-update`. It targets only `swartzit` and starts the
root-owned guest tools through `systemd-run --wait --pipe --collect`. The guest
manager reads `/etc/swartzit/upgrade.env`; the host adapter does not forward
database credentials in its arguments. Existing guest PostgreSQL helpers still
pass the service database URL to some child clients; moving those URLs out of
process arguments is a separate credential-handling improvement.

## Install reviewed deployment tools

Run these steps as root on SER8, using a reviewed commit from the checkout. Do
not copy privileged tools directly from a service-owned working tree. Archive
and install their committed contents into separate root-owned locations.

```sh
REVIEWED_COMMIT='reviewed-commit-sha'
tools_stage=$(mktemp -d /var/tmp/swartzit-tools.XXXXXX)
git -C /var/lib/swartzit -c safe.directory=/var/lib/swartzit archive "$REVIEWED_COMMIT" scripts \
  | tar -x -C "$tools_stage"
install -o root -g root -m 0755 "$tools_stage/scripts/swartzit-incus-update.sh" \
  /usr/local/sbin/swartzit-incus-update
incus --force-local exec swartzit -- install -d -o root -g root -m 0755 \
  /usr/local/libexec/swartzit/scripts
incus --force-local file push -r "$tools_stage/scripts" swartzit/usr/local/libexec/swartzit/
incus --force-local exec swartzit -- chown -R root:root /usr/local/libexec/swartzit
incus --force-local exec swartzit -- chmod -R go-w /usr/local/libexec/swartzit
incus --force-local exec swartzit -- chmod 0755 \
  /usr/local/libexec/swartzit/scripts/swartzit-linux-update.sh \
  /usr/local/libexec/swartzit/scripts/swartzit-release-update.sh
python3 "$tools_stage/scripts/swartzit-protect-code.py" /var/lib/swartzit
incus --force-local exec swartzit -- python3 \
  /usr/local/libexec/swartzit/scripts/swartzit-protect-code.py /var/lib/swartzit
rm -rf "$tools_stage"
```

The host adapter, guest tools, and every parent directory must be owned by root
and unwritable by the service and deploy accounts. The guest environment file
must also be root-owned and unwritable by those accounts. Keep its existing
settings and secrets; do not replace it with values from a source checkout.

Verify the guest environment names the actual service database and its approved
administrative endpoint (`SWARTZIT_PG_ADMIN_HOST`, `SWARTZIT_PG_ADMIN_PORT`, and
`SWARTZIT_PG_ADMIN_USER`), authentication settings, and API/web health addresses.
The PostgreSQL client tools must support the database server version. The
configured administrative account needs the existing disposable-role and
restore-rehearsal permissions. Confirm connectivity without printing secrets.

Add the adapter to the deploy account's sudoers policy using `visudo`:

```text
swartzit-deploy ALL=(root) NOPASSWD: /usr/local/sbin/swartzit-incus-update
```

Retain only the separately reviewed host backup preparation and enablement
command grants if the daily GitHub backup service runs on SER8. Do not retain a
generic host updater or root receipt-read grant. Its installer and helper scripts
must be protected from service-account writes too. The code protection helper
preserves designated runtime directories and prunes mounted paths; do not replace
it with recursive ownership changes over application data. Point guest release-check timers at the
root-owned guest tools; ensure obsolete host update timers cannot deploy to the
unused host application.

## Apply a release

```sh
sudo -n /usr/local/sbin/swartzit-incus-update --tag vX.Y.Z --dry-run
sudo -n /usr/local/sbin/swartzit-incus-update --tag vX.Y.Z --yes
sudo -n /usr/local/sbin/swartzit-incus-update --receipt
```

The existing guest updater downloads and verifies release assets, backs up the
real database, restores a disposable copy, and checks candidate migrations
before replacing the guest binary and web build. It verifies API readiness,
database health, and the web response, then writes the receipt inside the guest.
A dry run checks release asset availability; it does not perform the restore or
migration rehearsal. Check the guest receipt and public site after applying.

Release tool updates are a separate reviewed installation step. An application
release cannot replace the root-owned guest tools automatically. Do not bypass a
failed backup or rehearsal. Automatic code rollback does not undo database
migrations; retain the verified recovery bundle for an explicit database restore
if one is needed.

## Worker token and backup operations

The workflow's `sync-x-token` operation uses the same Incus adapter. It passes the
token over stdin into the guest's existing helper, which updates the live worker
configuration. The adapter permits this only as a standalone operation:

```sh
printf '%s' "$X_BEARER_TOKEN" \
  | sudo -n /usr/local/sbin/swartzit-incus-update --sync-x-token-stdin
```

The fixed `--receipt` mode reads the latest release receipt as the unprivileged
application account, so a state-directory symlink cannot expose root-only files; token synchronization
does not create a new release receipt. GitHub backup preparation and enablement
remain host operations because the daily backup job runs on SER8. They continue
using the host updater and its existing key locations, configuration, and timer.
The adapter rejects backup setup options, arbitrary instances, commands, and
updater paths.

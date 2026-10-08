# Incus single-instance deployment

Use one Ubuntu Linux container or VM for the API, website, worker and embedded
SQLite database. Run `scripts/install-server.sh` inside the guest with the public
origin and scheduler credentials supplied privately. It defaults to
`sqlite:/var/lib/swartzit/state/swartzit.sqlite`; no database VM is needed.

Keep the state directory on local persistent disk, with private ownership.
Expose Caddy or the website through your existing gateway; the API stays on
loopback. For a VM, use a static guest address and host routing/NAT appropriate
to the installed Incus version. An onion service can forward to the loopback
website without a public address or DNS record.

See [SQLite deployment](../../docs/sqlite-single-instance.md) for the importer,
backup verification, concurrency and recovery. Back up the database together
with canonical media and protected environment files. Database WAL files must
not be copied individually while the API is running; use the snapshot helper.

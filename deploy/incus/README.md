# Incus quickstart

Swartzit is designed to run as an ordinary Linux service inside an Incus
container or VM. A VM is a good default when the host is a personal Mac or when
stronger kernel isolation is desired.

```sh
incus launch images:ubuntu/24.04 swartzit --vm
incus config device add swartzit data disk source=/srv/swartzit path=/var/lib/swartzit
incus config device add swartzit http proxy listen=tcp:0.0.0.0:8080 connect=tcp:127.0.0.1:8080
incus exec swartzit -- bash
```

Inside the instance, install PostgreSQL, copy the compiled
`swartzit-server` binary to `/usr/local/bin`, create the `swartzit` service
user, and install `deploy/systemd/swartzit.service`. Set
`/etc/swartzit/server.env` to a private PostgreSQL URL, then enable the service:

```sh
systemctl enable --now postgresql
systemctl enable --now swartzit
```

For an onion-only host, do not add the `http` proxy device. Install Tor inside
the instance and use the configuration in `deploy/tor/README.md`; Tor can
forward to the loopback API without a public address or DNS name.

Keep `/srv/swartzit` backed up. It is the natural home for restored exports,
media manifests, and future signing keys.

For a conventional HTTPS host, point the proxy device at Caddy instead of the
application and use `deploy/caddy/Caddyfile`. Caddy should be the only service
bound to the public interface; the Swartzit API remains on loopback.

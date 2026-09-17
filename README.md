# Swartzit

> Read freely. Participate under a pseudonym. Take your community with you.

Swartzit is an open, self-hostable discussion network. The repository currently
contains the first server foundation: public read APIs for communities, posts,
threaded comments, and PostgreSQL full-text search.

## Development

Requirements: Rust stable and PostgreSQL 14+.

```sh
createdb swartzit
export DATABASE_URL=postgres://localhost/swartzit
cargo run -p swartzit-server -- --seed-demo
cargo run -p swartzit-server
curl http://127.0.0.1:8080/api/posts
# Subscribe without an account or JavaScript
curl http://127.0.0.1:8080/feed.xml
# Export public data for migration or backup
curl http://127.0.0.1:8080/api/export > swartzit-export.json
```

The API binds to localhost by default. Set `BIND_ADDR=0.0.0.0:8080` only when
placing it behind a trusted reverse proxy or Tor onion service.

## Deployment direction

The supported production shape is a Linux system container or VM managed with
Incus, with PostgreSQL on a private network and the server supervised by
systemd. OCI images remain an optional interoperability format for Apple
`container` on macOS and other runtimes; Docker is not required.

The first release deliberately keeps uploads and federation out of the public
API while their privacy, moderation, migration, and onion behavior are being
specified.

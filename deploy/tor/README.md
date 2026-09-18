# Optional onion service

Run Tor on the same host and forward an onion port to the loopback website. Keep
the generated `HiddenServiceDir` private and back it up with the instance data;
that directory contains the key that preserves the onion address during a
move. Onion-only hosts do not need a domain or a public IP.

Example `/etc/tor/torrc` fragment:

```
HiddenServiceDir /var/lib/tor/swartzit/
HiddenServicePort 80 127.0.0.1:4173
```

After starting or reloading Tor, read `/var/lib/tor/swartzit/hostname` locally
with the appropriate service-user permissions, then open that address in Tor
Browser. The directory must be owned by the Tor service user with mode 0700.
The Node website must be running on 4173 with `API_URL` pointing to the private
Rust API. See the [root README](../../README.md#onion-address-with-tor) for the
foreground macOS development commands. Do not enable direct peer-to-peer media in an
onion profile until its privacy properties have been reviewed.

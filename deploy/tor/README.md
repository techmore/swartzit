# Optional onion service

Run Tor on the same host and forward an onion port to the loopback API. Keep
the generated `HiddenServiceDir` private and back it up with the instance data;
that directory contains the key that preserves the onion address during a
move. Onion-only hosts do not need a domain or a public IP.

Example `/etc/tor/torrc` fragment:

```
HiddenServiceDir /var/lib/tor/swartzit/
HiddenServicePort 80 127.0.0.1:8080
```

Use Tor Browser to read the hostname printed in
`/var/lib/tor/swartzit/hostname`. Do not enable direct peer-to-peer media in an
onion profile until its privacy properties have been reviewed.

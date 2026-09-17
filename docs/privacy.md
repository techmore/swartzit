# Privacy and availability model

Swartzit treats public reading and operator privacy as separate concerns.

- Public posts are readable without an account and may be replicated by hosts,
  mirrors, feed readers, or export downloads.
- A Tor onion service hides the service operator’s network location and does not
  require DNS, but the operator still controls a real machine and its logs.
- IPFS and torrent networks are content-addressed and can expose which nodes
  provide public content. They are optional delivery mechanisms, not anonymity
  systems.
- Onion profiles should use HTTP delivery through Tor. Direct WebRTC/WebTorrent
  connections remain disabled until their peer-address and metadata behavior is
  explicitly reviewed.
- Deleting content from one host cannot guarantee deletion from independent
  replicas. Operators should explain this before accepting uploads.

The threat model is intentionally explicit: Swartzit improves resilience to a
blocked domain or unavailable host, but it cannot guarantee communication during
a complete network shutdown or protect an operator who leaks identifying data
through administration, logging, or account recovery.

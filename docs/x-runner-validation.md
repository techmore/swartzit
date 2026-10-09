# X import runner validation

The X importer supports the official API and an explicitly configured, dedicated signed-in browser provider. Browser collection reads public content; it does not post, like, repost, follow or message on X.

## Repairs

- Browser topic collection uses Latest search results, translates supported operators outside quoted phrases and enforces exact timestamps after resolving public source URLs.
- The browser result's canonical source URL preserves its original author rather than inventing a profile URL for search results.
- The shared resolver retains full text, quote/thread context and trusted media.
- Recent-search exclusions use query operators. The account timeline keeps its separate `exclude` parameter.
- The CLI separates its publication cap from its ranked candidate pool, allowing the worker to replace already-imported candidates with fresh posts.

## Validation

All 50 targeted tests passed on Linux, covering context, media, source ownership, time bounds, empty results, credential encoding, candidate pools, prompts, worker paths and publisher receipts.

Bounded live collector checks returned eligible topic and account candidates with a one-post publication cap. A worker dry run produced a context-rich preview without creating a post. One authorized import preserved the collected body, quoted context, provider and canonical source URL. Replaying the same input created no duplicate.

Detailed deployment configuration, infrastructure identifiers, credentials, source batches, post identifiers and operational receipts are kept outside the public repository. Runtime credentials and dedicated browser profiles must remain outside Git.

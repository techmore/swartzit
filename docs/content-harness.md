# Browser content harness

`scripts/content-harness.mjs` is the boundary between browser collection and publishing.
The browser driver (currently the signed-in X page; later FluidUse) emits a JSON array. The harness:

- canonicalizes X status URLs so `x.com`, `twitter.com`, and tracking links collapse to one source;
- keeps source URLs and media fingerprints in `.local/content-harness-state.json`;
- can add MD5 and SHA-256 fingerprints to image/video records with `--fingerprint`;
- selects a seeded random subset for a future rerunner, excluding anything already used.

Example:

```sh
node scripts/content-harness.mjs \
  --input .local/import-previews/daddario-browser-test-publishable.json \
  --output .local/import-previews/daddario-rerun.json \
  --state .local/content-harness-state.json \
  --limit 20 --seed 2026-09-22 --fingerprint
```

For a fresh capture, `--enrich-x` resolves X media metadata and `--bootstrap FILE` treats an older publishable batch as already used:

```sh
node scripts/content-harness.mjs --input .local/import-previews/daddario-fresh-browser.json \
  --bootstrap .local/import-previews/daddario-browser-test-publishable.json \
  --output .local/import-previews/daddario-fresh-rerun.json --limit 20 --seed 2026-09-22 --enrich-x --fingerprint
```

Use `--post-contains "Alexandra Daddario"` when a profile's media tab also contains unrelated celebrity posts; it matches the post text after the profile header.

The harness does not publish or repost. Publishing remains a separate bounded step, so a bad capture cannot silently become a timeline action.

After a batch has been published successfully, rerun the harness with `--mark-selected` to checkpoint those source URLs and fingerprints. The next run will exclude them.

# Swartzit runners

Swartzit has one publisher and several collectors. Keeping that boundary clear
prevents duplicate imports, overlapping jobs, and credentials leaking into the
web process.

| Component | Runs where | Responsibility | Start it with |
| --- | --- | --- | --- |
| `scripts/run-local.sh` | Mac | PostgreSQL, API, LAN web server, optional Caddy | `bash scripts/run-local.sh` |
| `scripts/swartzit-worker.mjs` | Linux/Incus | Claims enabled admin crawler jobs and records run results | systemd timer |
| Content runners | Worker host | Runs administrator-configured command/cross-post publishers with lifecycle, retry, timeout, and log policy | Admin → Content Runners |
| `scripts/hermes-content-sync.mjs` | Local Hermes machine | Publishes collector JSON from an inbox, leaving failures for retry | `node scripts/hermes-content-sync.mjs --inbox .local/hermes/inbox` |
| `scripts/scheduled-imports.mjs` | Local or hosted | **The only source submitter**; validates, enriches, deduplicates, and sends imports to the moderation gate | called by the runners |
| Codex content-sync heartbeat | Mac + signed-in Brave | Collects Following/For You X posts and runs the bounded Daddario check | Codex automation |
| `scripts/x-faith-runner.mjs` | Opt-in worker job | Produces a ranked, reviewed X/Reddit faith batch | run manually or from a reviewed job |
| `scripts/x-cross-post-runner.mjs` | Content Runner worker host | Collects bounded public X posts from multiple accounts/topics and time windows | Admin → Content Runners → X topic window |
| `scripts/draw-things-runner.mjs` | Content Runner worker host | Builds safe Draw Things argv and generation metadata for local Apple Silicon inference | used by `scripts/swartzit-worker.mjs` |
| `scripts/runner-prompt.mjs` | Content Runner worker host | Expands deterministic date, runner, destination, seed, and variant prompt tokens | used by generic and Draw Things runners |
| `scripts/cache-profile-images.mjs` | After imports | Copies public X avatars into the local profile cache | worker maintenance step |

The remaining scripts are helpers or one-shot maintenance tools:
`crawler-adapters.mjs` contains provider adapters, `prepare-import.mjs` turns a
Commons manifest into records, and `backfill-x-media.mjs` repairs old X posts.
They are not independent schedulers.

Content runners are the publishing side of the worker. They are disabled at the
module level by default, execute one at a time in priority order, and submit
their output to the normal moderation queue. See [content-runners.md](content-runners.md)
for the command contract and lifecycle behavior.

## Rules for every runner

1. Collectors write a fresh normalized JSON batch. They do not write directly to
   the database.
2. `scheduled-imports.mjs` is the only code path that submits source content to
   the API. Its per-job lock and canonical source URL deduplication make retries
   safe; newly created posts remain hidden until moderator approval.
3. A failed batch stays available for retry and never advances a Daddario
   checkpoint. Missing metrics remain `null`; a runner must not guess them.
4. Browser collection belongs on the Mac/Codex side. Hosted Linux jobs use the
   official API adapters and their environment-file credentials; they never
   scrape browser cookies.
5. The profile-image cache is bounded maintenance, not a media mirror. It runs
   after a successful worker pass and never blocks publication of unrelated
   content.

## Local operations

```sh
# Fast, idempotent startup after a reboot (reuses healthy services/builds).
bash scripts/run-local.sh

# Optional public HTTPS terminator after router forwarding and DNS are ready.
SWARTZIT_DOMAIN=stoverparc.org SWARTZIT_CADDY=1 bash scripts/run-local.sh

# Stop API/web/Caddy without deleting the database volume.
bash scripts/stop-local.sh

# Inspect all local listeners and dependencies.
bash scripts/status-local.sh
```

The local launcher writes only `.local/*.log`, `.local/*.pid`, and generated
Caddy configuration. Those files are ignored by Git and are safe to remove if
the launcher needs to recover a stale process state.

## Hosted operations

The Ubuntu installer installs exactly one worker timer:
`swartzit-worker.timer` starts `swartzit-worker.service` once per minute. The
worker claims due jobs from the admin API, invokes the same publisher, records a
run receipt, and then refreshes profile avatars. Inspect it with:

```sh
systemctl status swartzit-worker.timer
journalctl -u swartzit-worker.service --since today
```

Do not add a second cron entry for the same job. Configure or pause jobs in the
admin Crawler Jobs view; the timer is the scheduler and the job record is the
source of truth for interval, provider, destination, and moderation mode.

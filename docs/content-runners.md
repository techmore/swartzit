# Content runners

Content runners are an opt-in admin module for scheduled, host-side publishing.
The worker claims due runners in priority order and waits for each one to finish
before claiming the next. A runner starts as a draft; an administrator enables
the module in **Admin → Settings** and then enables the individual runner.

Runner lifecycle is explicit:

```text
draft → enabled ⇄ paused
          ↓
       running → success
          ↓
       retrying → success
          ↓
        failed → paused (failure threshold)

enabled/paused → archived
```

The admin surface can edit a draft or active configuration, enable/pause it,
queue it immediately, archive it, replay a prior run, run a no-publish dry run,
and inspect the latest structured run history. Archived runners remain
available in run history but cannot be scheduled again.

Generic commands are stored as an argv array, not a shell command. This avoids
shell expansion. The command receives:

- `RUNNER_PROMPT` — the runner prompt from Admin.
- `RUNNER_OUTPUT_PATH` — a worker-local JSON receipt path for generic adapters.
- `SWARTZIT_RUNNER_NAME` — configured runner name.
- `RUNNER_DRY_RUN` — `true` for a Test execution, which never publishes.

Only the normal process environment (`PATH`, `HOME`, locale, and similar
runtime values) plus explicitly configured environment key names are passed to
the command. Secret values are not stored in the database; provision them in
the worker service environment and allow-list their names on the runner.

The command must print a JSON object as its final stdout line. It may describe
one post or a batch:

```json
{
  "title": "Generated bedroom study",
  "body": "Generated from the scheduled image prompt.",
  "source_url": "https://media.example.test/generated/bedroom-001.png",
  "media": [{"kind": "image", "src": "https://media.example.test/generated/bedroom-001.png"}]
}
```

```json
{
  "posts": [
    {"title": "One", "body": "…", "media": []},
    {"title": "Two", "body": "…", "media": [{"path": "/tmp/two.png"}]}
  ]
}
```

The worker supplies the configured author and community; the command cannot
override those destinations. It submits the returned post through the admin
runner endpoint, where it enters the normal moderation queue. A command failure is recorded against the
runner and does not block later runners. Each run stores its attempt number,
configuration version, exit code, duration, timeout flag, stdout/stderr (when
enabled), error, retry time, and structured detail.

## Draw Things runner

Choose **Draw Things image generator** in Admin → Content Runners. The editor
stores a structured command configuration and the worker invokes Draw Things
without a shell:

- executable, models directory, model, prompt, width, height, steps, CFG, and
  optional starting seed;
- zero or more LoRAs with `file`, `version`, and `weight`;
- output path/template, title prefix, and 1–8 posts per run.

For multiple posts, `{index}` is replaced with a one-based variant number. If
the starting seed is set, each variant increments it. A local output image is
uploaded to Swartzit’s provider-neutral media store and displayed at `/media/{id}`
(with `/media/{id}/thumbnail` available for generated previews); the
post body and `generation_config` source metadata include the prompt, model,
LoRAs, dimensions, steps, CFG, and seed so a successful recipe can be reused.
Images are limited to 5 MB and PNG, JPEG, WebP, and GIF.

The **Test · no publish** action claims one queued dry-run execution. It runs
the actual command and leaves generated files on the worker, records a preview
and output paths in the run detail, and does not upload media or create posts.
Use **Run now** only after the dry run is successful; that path uploads images
and creates the normal moderation submissions.

Schedules use ISO weekdays (Monday=1 through Sunday=7) plus the interval. A
database advisory lock and the active-run gate keep all runner processes
sequential, while priority controls which due runner is claimed first.

Each runner supports a timeout, maximum attempts, exponential retry backoff,
failure threshold, log capture/size policy, and run-log retention period. A
runner is automatically paused after its configured number of exhausted failure
cycles. A five-minute server maintenance pass removes completed run logs after
the runner's retention period and reaps worker leases that have been running for
more than two hours.

The worker still receives its normal allow-listed environment and never stores
credentials in runner configuration. Absolute macOS paths are supported for a
Draw Things installation, but should be kept to the worker host that actually
has the models.

The existing crawler jobs remain the right choice for recurring X, Reddit, RSS,
and Commons collection. The `cross_post` runner type currently uses the same
argv/output contract, leaving room for a future reviewable adapter that can
reuse those source collectors without mixing source collection and command
execution.

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

The Content Runners page includes disabled starter templates: a single-post
smoke test, a prompt-shaped draft, a bounded two-post batch, an X topic-window
adapter, and two Draw Things recipes. **Use template**
opens a copy in the editor; saving creates a normal draft with `enabled = false`.
**Save & test** saves the draft and queues its no-publish execution in one step.
The runner card reports `Test queued`, `Test running`, and the completed result as
the worker refreshes the page. Existing runners can be copied with **Duplicate**.
The recipes are implemented in `scripts/runner-starter.mjs` and covered by
`scripts/runner-starter.test.mjs`, so they are useful as known-good command
contracts before replacing the command with a real generator. Draw Things helper
logic is shared by `scripts/draw-things-runner.mjs`, and prompt expansion is
covered by `scripts/runner-prompt.test.mjs`.

Generic commands are stored as an argv array, not a shell command. This avoids
shell expansion. The command receives:

- `RUNNER_PROMPT` — the runner prompt from Admin.
- `RUNNER_OUTPUT_PATH` — a worker-local JSON receipt path for generic adapters.
- `SWARTZIT_RUNNER_NAME` — configured runner name.
- `RUNNER_DRY_RUN` — `true` for a Test execution, which never publishes.

Prompts support deterministic runtime tokens: `{date}`, `{time}`, `{weekday}`,
`{iso}`, `{runner}`, `{community}`, `{author}`, `{run_id}`, `{seed}`,
`{index}`, `{total}`, and `{dry_run}`. Unknown tokens are left unchanged. The
worker expands the prompt once for each Draw Things variant, so a scheduled
recipe can vary by day or variant without adding a model or remote service.

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
runner endpoint, where it follows the instance's current publication setting
(approved immediately when moderation is disabled). A command failure is recorded against the
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
Images are limited to 5 MB and PNG, JPEG, WebP, and GIF. The worker uploads
generated images over the binary runner-media endpoint so the request does not
double in size through hexadecimal JSON encoding. During a rolling upgrade it
can fall back to the legacy JSON endpoint; keep `API_URL` pointed at the
worker's private Swartzit API (for example `http://127.0.0.1:18080`) rather
than the public web origin so a web proxy cannot impose a smaller upload limit.

For example, a designer recipe is stored like this:

```json
{
  "models_dir": "~/Library/Containers/com.liuliu.draw-things/Data/Documents/Models",
  "model": "flux_1_dev_q8p.ckpt",
  "steps": 28,
  "cfg": 3.5,
  "seed": 123,
  "loras": [
    {"file": "flux_alexandra_daddario_lora_f16.ckpt", "version": "flux1", "weight": 0.8}
  ]
}
```

The worker turns that into Draw Things' native `--config-json '{"loras":[...]}'`
argument. The LoRA file must already exist in the configured Draw Things model
directory; Swartzit does not silently download or replace designer assets.
Leave `cfg` blank when the model's recommended guidance should be preserved.

### Live progress and ETA

While a Draw Things process is running, the worker parses the CLI's existing
progress output (`Starting`, `Processing`, `Sampling`, `Finishing`, and
`Generated`). It sends at most one progress update every four seconds, plus
the first and final states. The admin runner card and its history then show:

- overall percentage for the complete run, including multi-image runs;
- the current Draw Things phase and sampling step when the CLI reports one;
- elapsed time from the run record; and
- an approximate remaining time calculated from observed progress.

The ETA is intentionally labeled approximate. Model loading, memory pressure,
LoRA initialization, media upload, and post publication can take time that is
not represented by the CLI percentage. If a generic runner does not emit a
recognized progress line, the admin still shows that it is running and its
elapsed time, but does not invent a percentage or ETA.

Generated Draw Things posts include a separate feedback panel on their post
page. A signed-in person can save one overall 1–5 rating plus optional 1–5
signals for prompt match, natural color, realism, likeness, composition, and
detail; **Skip** is available for dimensions that do not apply. Feedback is
updatable, is not a moderation action, and is not mixed into the normal
upvote/downvote score. The post exposes aggregate averages and response count
so future prompt and model experiments can compare what people preferred
without storing free-form review text.

The **Test · no publish** action claims one queued dry-run execution. It runs
the actual command and leaves generated files on the worker, records a preview
and output paths in the run detail, and does not upload media or create posts.
Use **Run now** only after the dry run is successful; that path uploads images
and creates posts using the instance's current publication setting.

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

## X cross-post runner

`scripts/x-cross-post-runner.mjs` is a generic `cross_post` runner command. It
uses `X_BEARER_TOKEN` with the official X API through `crawler-adapters.mjs` and
prints the bounded `{ "posts": [...] }` contract expected by the worker. It
supports:

- multiple accounts through `--accounts @one,@two` or `X_RUNNER_ACCOUNTS`;
- topics through `--topics "local AI,Draw Things"`, repeated `--topic`, or
  `X_RUNNER_TOPICS`;
- explicit `--start-time` / `--end-time`, or a rolling `--hours` window;
- explicit queries through repeated `--query` and optional inclusion of replies
  or retweets;
- de-duplication, local time-window enforcement, engagement ordering, and a
  maximum of eight posts per execution.

For the starter template, allow-list these worker environment names without
storing their values in the database:

```text
X_BEARER_TOKEN, X_RUNNER_ACCOUNTS, X_RUNNER_TOPICS
```

The normal X recent-search API has its own availability window and plan limits;
the runner does not pretend to retrieve content the API cannot return. An empty
window is a successful no-content result, while authentication, query, and API
errors are recorded as a failed runner attempt.

The existing crawler jobs remain the right choice for broad recurring imports.
Use the X cross-post runner when the source list, topic window, and destination
need to be versioned together as one bounded scheduled workflow.

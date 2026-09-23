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
queue it immediately, archive it, replay a prior run, and inspect the latest
structured run history. Archived runners remain available in run history but
cannot be scheduled again.

The command is stored as an argv array, not a shell command. This avoids shell
expansion and makes the worker suitable for commands such as Draw Things. The
command receives:

- `RUNNER_PROMPT` — the runner prompt from Admin.
- `RUNNER_OUTPUT_PATH` — reserved path for a future file-output adapter.
- `SWARTZIT_RUNNER_NAME` — configured runner name.

Only the normal process environment (`PATH`, `HOME`, locale, and similar
runtime values) plus explicitly configured environment key names are passed to
the command. Secret values are not stored in the database; provision them in
the worker service environment and allow-list their names on the runner.

The command must print a JSON object as its final stdout line:

```json
{
  "title": "Generated bedroom study",
  "body": "Generated from the scheduled image prompt.",
  "source_url": "https://media.example.test/generated/bedroom-001.png",
  "media": [{"kind": "image", "src": "https://media.example.test/generated/bedroom-001.png"}]
}
```

The worker supplies the configured author and community; the command cannot
override those destinations. It submits the returned post through the admin
runner endpoint, where it enters the normal moderation queue. A command failure is recorded against the
runner and does not block later runners. Each run stores its attempt number,
configuration version, exit code, duration, timeout flag, stdout/stderr (when
enabled), error, retry time, and structured detail.

Each runner supports a timeout, maximum attempts, exponential retry backoff,
failure threshold, log capture/size policy, and run-log retention period. A
runner is automatically paused after its configured number of exhausted failure
cycles. A five-minute server maintenance pass removes completed run logs after
the runner's retention period and reaps worker leases that have been running for
more than two hours.

For a local Draw Things installation, use a small wrapper executable as the
runner command. The wrapper can invoke `draw-things-cli`, upload or expose the
result through the media host, and print the receipt above. Keeping that
machine-specific wrapper outside Swartzit avoids storing absolute macOS model
paths or credentials in the database. Direct local-file attachment is the next
adapter to add; the current contract intentionally requires a browser-reachable
media URL.

The existing crawler jobs remain the right choice for recurring X, Reddit, RSS,
and Commons collection. The `cross_post` runner type currently uses the same
argv/output contract, leaving room for a future reviewable adapter that can
reuse those source collectors without mixing source collection and command
execution.

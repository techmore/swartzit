# Benchmark batteries from archived bookmarks

This is the first battery-runner slice for issue #87. It runs trusted local adapter programs over an immutable snapshot of a private bookmark-media manifest. It never changes bookmarks or ratings. Use `scripts/benchmark/battery.py` with a separate private SQLite database; the existing `results.sqlite` and its ongoing baseline are untouched. The runner records each tool, iteration, attempt, input hash, model and adapter digests, coverage, output, timings and host details. A failed job can be retried without erasing the prior attempt; a stopped run can be resumed.

The manifest exporter marks a human label as snapshot-verified only when its reviewed snapshot still matches the current post. A human accuracy score additionally requires the held-out post split, complete content coverage, a matching rating policy version, the first iteration, and an exact match between the reviewed image artifact and the adapter's prepared image. Text-only posts require no reviewed image artifacts. A model suggestion is never a label. The report produces a confusion matrix and per-class precision/recall only for matching samples. Until human labels exist, it reports zero eligible samples. These checks deliberately exclude ambiguous cases instead of guessing.

## On Ser8

The archive and its manifest are in the Swartzit guest. The benchmark runs on the host. Install `battery.py` and `adapters.py` into a private host working directory that has the existing MobileNet/Qwen benchmark virtual environment. Refresh and copy the manifest locally using the existing Incus access:

```sh
incus exec swartzit -- runuser -u swartzit -- python3 /var/lib/swartzit/state/export-bookmark-media-manifest.py --handle techmore
incus exec swartzit -- runuser -u swartzit -- cat /var/lib/swartzit/state/bookmark-media-archive/manifest.jsonl > "$HOME/.local/share/swartzit-mobilenet-trial/battery-manifest.jsonl"
```

Use a restrictive umask (`umask 077`), because the manifest and database include private bookmark content. Run `python3 configure-ser8.py --output "$HOME/.local/share/swartzit-mobilenet-trial/battery-config.json" --iterations 2` to generate a starter configuration from the installed model digests. Alternatively, configure a JSON file with `iterations`, `timeout_seconds`, and a `tools` array. Each tool supplies a unique `id`, `task` (`rating`, `object`, or `other`), `input` (`image`, `text`, or `multimodal`), `model`, `model_digest`, and `argv` array. Rating tools should also supply the `policy_version` that their prompt implements. `argv` is a trusted local adapter executable and arguments, not a shell command. The runner fingerprints executable/script files when the run is created and rejects changed files on resume. `adapters.py` supports `adapter: "mobilenet"` with `model_path`, `labels_path`, and `labels_sha256`, and `adapter: "qwen"` for a local Ollama model. The MobileNet digest covers the ONNX graph followed by its external weights file; Qwen's digest comes from Ollama's `/api/tags`. Optional Qwen `prompt` is saved in the run configuration.

```sh
state="$HOME/.local/share/swartzit-mobilenet-trial"
"$state/venv/bin/python" "$state/battery.py" --db "$state/batteries.sqlite" create --manifest "$state/battery-manifest.jsonl" --config "$state/battery-config.json" --name baseline
"$state/venv/bin/python" "$state/battery.py" --db "$state/batteries.sqlite" run --id 1 --cache "$state/battery-originals" --archive-site https://swartzit.stoverparc.org
"$state/venv/bin/python" "$state/battery.py" --db "$state/batteries.sqlite" summary --id 1
"$state/venv/bin/python" "$state/battery.py" --db "$state/batteries.sqlite" compare --left 1 --right 2
```

Use the ID returned by `create`. `--max-jobs` limits one invocation, and `--retry-errors` records another attempt for failed jobs. Runs compare only matching post-input hashes and iteration numbers, and the comparison keeps different tasks separate. Original image bytes are read from the local archive endpoint without following redirects to X, verified by SHA-256 and size, and reused from the private host cache on subsequent iterations and runs. An unavailable original is recorded as an error; it is not silently redownloaded from X. The runner currently reviews at most one image per post, recording partial coverage for additional images, videos, or truncated text. Full video frame extraction and a general-purpose multi-image adapter remain future work.

Adapters consume one JSON request on stdin and return one JSON object on stdout. Their reported metrics are preserved as supplied. Wall time includes adapter process startup; model timing metrics and cache-preparation time are reported separately. Adapter peak RSS does not include an external Ollama server's memory or GPU usage. External adapters must verify their own model digest and describe their preprocessing and coverage. Treat configurations and executables as trusted host code.

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

Use the ID returned by `create`. `--max-jobs` limits one invocation, and `--retry-errors` records another attempt for failed jobs. Runs compare only matching post-input hashes and iteration numbers, and the comparison keeps different tasks separate. Original image bytes are read from the local archive endpoint without following redirects to X, verified by SHA-256 and size, and reused from the private host cache on subsequent iterations and runs. An unavailable original is recorded as an error; it is not silently redownloaded from X. For still images, the runner currently reviews at most one image per post and records partial coverage for additional images or truncated text. Video inputs use the sampled-frame workflow below; a general-purpose multi-image adapter remains future work.

Adapters consume one JSON request on stdin and return one JSON object on stdout. Their reported metrics are preserved as supplied. Wall time includes adapter process startup; model timing metrics and cache-preparation time are reported separately. Adapter peak RSS does not include an external Ollama server's memory or GPU usage. External adapters must verify their own model digest and describe their preprocessing and coverage. Treat configurations and executables as trusted host code.

## Video frames and Gemma 4 12B

Video tools use `input: "video"` or `input: "multimodal_video"` and `video_frames` from 1 to 8 (default 3). Install `ffmpeg` and `ffprobe` on the host before creating the battery. For the first verified archived video in a post, the runner samples evenly spaced interior timestamps—for three frames, 25%, 50% and 75% of the duration—and creates JPEGs with maximum dimensions of 512 pixels. It records each original video hash, frame hash, timestamp, duration, extraction method, FFmpeg version and executable digest. Cached originals are streamed and checksum-verified; derived frames are reused only after their hashes verify. Both Qwen and Gemma receive every sampled frame in chronological order.

Sampling excludes unsampled video and audio. Video outputs are always marked partial and are not included in held-out human accuracy scores. The comparison requires the same source snapshot and the same sampled-frame hashes; different FFmpeg output is not silently treated as the same sample. A 30 GiB free-space floor protects the host when copying large original videos into the private benchmark cache.

To add the linked LiteRT Gemma model on Ser8, copy `install-gemma-litert.sh`, `configure-gemma.py`, and `battery.py` into the private benchmark directory, and copy `adapters.py` there as `adapters-video-gemma-v2.py`. The versioned name preserves older batteries' pinned adapter files. The installer creates a separate `gemma-venv`, installs `litert-lm-api==0.18.1`, downloads the approximately 6.9 GB `litert-community/gemma-4-12B-it-litert-lm` model from a pinned revision, and verifies the pinned SHA-256 before use. It requires at least 30 GB free before downloading. It does not automatically start inference or change the existing Qwen worker.

```sh
state="$HOME/.local/share/swartzit-mobilenet-trial"
bash "$state/install-gemma-litert.sh"
"$state/gemma-venv/bin/python" "$state/configure-gemma.py" --output "$state/gemma-video-config.json" --input multimodal_video --frames 3 --iterations 2 --backend cpu
"$state/venv/bin/python" "$state/battery.py" --db "$state/batteries.sqlite" create --manifest "$state/battery-manifest.jsonl" --config "$state/gemma-video-config.json" --name gemma-qwen-video --media-kind video --ready-only --limit 10
```

Use the returned ID with the existing `run` and `summary` commands. Start with a small sample and inspect memory and latency before expanding the run. CPU with four threads is the default; GPU is an explicit option and must be tested on the host. The Gemma adapter runs as a separate subprocess, pins the runtime and model hashes, reserves 4 GiB of available memory beyond the model-file size and requires swap headroom, and records load, hashing, preprocessing and inference times. This is a guard, not a guarantee of the model's total memory demand. Runtime failures or unsupported GPU backends are recorded as failed attempts; no production ratings are changed. Gemma 4 12B and LiteRT-LM have not been validated on Ser8 merely by adding the adapter.

For an unattended first smoke test, `first-gemma-trial.py` waits up to one hour for the installer to finish and for the memory and swap reserves, selects one cached video under 20 MiB, runs one Gemma and one Qwen iteration, and writes `gemma-first-trial-summary.json` in the private state directory. It exits with an error after the bounded wait rather than retrying forever. Its video sample is intentionally small and cannot establish accuracy. Inspect the user-service journal and the per-job errors before retrying or increasing the sample size.

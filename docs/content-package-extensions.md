# Optional content-package extensions

`content_package` is an optional host-side runner kind. Swartzit does not
import a pack's Python modules, install its models, or change the server bind.
When the Content Runners module is disabled, these runners are not claimed and
the normal Swartzit install remains unchanged.

## First pack

The first adapter lives in the sibling project:

```text
../Starwars_Anatomy_of_a_Catastrophe_Gravedancer_to_General/
└── scripts/swartzit_pack_runner.py
```

Create a disabled draft from **Admin → Content Runners → Gravedancer to
General pack**. Its runner command is an argv array, not a shell command:

```json
{
  "pack": "starwars.gravedancer",
  "argv": ["python3", "scripts/swartzit_pack_runner.py", "--pack", "starwars.gravedancer"],
  "working_dir": "../Starwars_Anatomy_of_a_Catastrophe_Gravedancer_to_General",
  "options": {
    "seed": 42,
    "days": 7,
    "fast": true,
    "model": "mlx-community/gemma-4-e4b-it-OptiQ-4bit",
    "generate_images": false,
    "publish_mode": "article_units",
    "draw_things": {
      "backend": "cli",
      "model": "flux_1_schnell_q5p.ckpt",
      "width": 1024,
      "height": 576,
      "steps": 4,
      "cfg": 1.4,
      "loras": []
    }
  }
}
```

The adapter outputs `content-package.v1`: one package with ordered article
units, provenance, optional assets, and a small feed item. Existing episodes
can be backfilled without generation:

```bash
cd ../Starwars_Anatomy_of_a_Catastrophe_Gravedancer_to_General
python3 scripts/swartzit_pack_runner.py --backfill episodes/<episode-id>
```

## Async protocol

The adapter may write normal logs, plus one JSON object per line:

```json
{"type":"progress","phase":"day-3","message":"Expanding Day 3","percent":42}
{"type":"checkpoint","checkpoint":{"kind":"day","day":3,"completed_days":3,"total_days":7}}
{"type":"package","package":{"format":"content-package.v1","title":"…","units":[{"id":"day-1","kind":"article","title":"…","body":"…"}]}}
```

Swartzit stores progress and the latest checkpoint on the run, and sends a
heartbeat during quiet local model work. A pause request is cooperative: the
worker retains the most recent completed checkpoint, terminates the adapter
after that safe boundary, and records the run as `paused`. **Resume from
checkpoint** queues a new run and passes the checkpoint context back through
`RUNNER_RESUME_CHECKPOINT_JSON`.
Cancel uses the same durable boundary and leaves the runner paused so it does
not unexpectedly regenerate content later.

The package adapter is the extension boundary. A future fiction, newsletter,
tutorial, podcast, or image-collection pack only needs to emit the same
manifest and frames; it does not need a Swartzit server plugin.

`publish_mode` controls how the package becomes visible on the timeline:

* `article_units` publishes every ordered `article` unit as its own long-form
  Swartzit post, including that unit's body and media. Each unit gets a stable
  `swartzit://content-package/.../<unit-id>` source so reruns reuse the same
  source identity instead of duplicating the article.
* `feed_item` publishes only the package's compact summary post.
* `none` validates generation and checkpoints without publishing.

The host's normal post page is the article view for `article_units`, so each
day has its own URL, comments, reactions, and media while the runner remains an
optional extension outside Swartzit core.

## Draw Things starting point

The verified local CLI shape is:

```bash
draw-things-cli generate \
  --model flux_1_schnell_q5p.ckpt \
  --prompt "a lighthouse on a rocky cliff at dusk, waves crashing, cinematic light" \
  --width 1024 --height 1024 --steps 4 --seed 42 \
  --output ~/DrawThings/lighthouse-test.png
```

For the Star Wars pack, start with Flux 1 Schnell at 1024×576, 4–8 steps,
and the model's recommended guidance or a modest CFG. Use the existing
`schnell-cinematic` style profile before adding a LoRA. A LoRA should only be
added when its exact file is present on the worker host and known to match the
model family; its filename, version, and weight are recorded in the pack
options. The extension never downloads or silently swaps designer assets.

Enable `generate_images` only after the text run works. That keeps the local
MLX and Draw Things workloads explicit on a unified-memory Mac and makes a
pause/resume boundary easy to reason about.

#!/usr/bin/env bash
# Install the pinned model and runtime in a private host directory.
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'Run this installer on the Linux host.' >&2; exit 1; }
umask 077
root=${SWARTZIT_BENCHMARK_STATE:-"$HOME/.local/share/swartzit-mobilenet-trial"}
model="$root/gemma-4-12B-it.litertlm"
expected=58fd31b778ca2c21c80d634fb34fc5a89d11d563a38dfd3cbf1b40dbf252a8b6
revision=7a0b1ce0ea821bcd01c5f72af84155e02191152f
mkdir -p "$root"
if [[ -f "$model" ]]; then
  actual=$(sha256sum "$model" | cut -d' ' -f1)
  [[ $actual == "$expected" ]] || { echo 'Existing model hash does not match the pinned model.' >&2; exit 1; }
else
  free_kib=$(df -Pk "$root" | awk 'NR==2 {print $4}')
  (( free_kib > 30000000 )) || { echo 'At least 30 GB of free space is required before downloading.' >&2; exit 1; }
  curl --fail --location --retry 3 --continue-at - --limit-rate "${SWARTZIT_GEMMA_DOWNLOAD_RATE:-20M}" --output "$model.part" "https://huggingface.co/litert-community/gemma-4-12B-it-litert-lm/resolve/$revision/gemma-4-12B-it.litertlm"
  actual=$(sha256sum "$model.part" | cut -d' ' -f1)
  [[ $actual == "$expected" ]] || { echo 'Downloaded model hash does not match; leaving the partial file for inspection.' >&2; exit 1; }
  mv "$model.part" "$model"
fi
python3 -m venv "$root/gemma-venv"
"$root/gemma-venv/bin/pip" install 'litert-lm-api==0.18.1' Pillow
"$root/gemma-venv/bin/python" -c 'import importlib.metadata; import litert_lm; print("LiteRT-LM API",importlib.metadata.version("litert-lm-api"))'
printf 'Pinned Gemma model and runtime are ready at %s\n' "$root"

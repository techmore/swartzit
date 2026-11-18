# Offline media archive

`scripts/archive/media_archive.py` keeps an offline copy of a curated set of
**official** sources (YouTube channels and podcast feeds) on local or network
storage, such as a NAS. It is separate from the Swartzit server: the archive is
private storage, and Swartzit's feeds keep linking to the original publishers.

## What it saves

- **YouTube:** the highest resolution available (up to 4K) with the
  **original-language audio track** (never YouTube's AI-dubbed tracks), the
  thumbnail, and English captions. Among equal resolutions YouTube's own AV1
  stream is preferred, so most videos need no conversion. Other codecs are
  converted with SVT-AV1 (preset 8, CRF 33, 10-bit) at low priority, and the
  conversion is kept only if it is under 80% of the original's size and the
  same length.
- **Podcasts:** every episode in the feed, as published (no re-encoding).
- **Provenance:** next to every file is a `.json` record with the original URL,
  channel and channel id, upload date, description, chapters, the exact format
  downloaded, and SHA-256 checksums of the file as downloaded and as stored. A
  source's `channel_id` is checked on discovery and on every download, so a
  look-alike channel cannot slip in. `_archive/manifest.jsonl` collects every
  record.

## Only the subject

A channel can keep publishing after the person it is named for has died,
with other hosts, tributes and news. The optional `subject` block keeps the
archive about the person:

- Everything published on or before `until` is kept.
- After it, an item is kept only when its title matches `after_title_match`
  (an archived speech, a debate compilation, "From the Archive") and does not
  match `after_title_exclude` (tributes, memorials, other hosts, coverage of
  the death).
- YouTube items are checked on their metadata before anything is downloaded.

To apply a changed rule to what is already saved:

```sh
python3 media_archive.py --config charlie-kirk.json --apply-subject --dry-run   # list only
python3 media_archive.py --config charlie-kirk.json --apply-subject
```

Items the rule no longer keeps move to `_Set aside (not <name>)/` in the
archive (nothing is deleted) and their Swartzit posts are taken down through
`POST /api/admin/posts/{id}/remove`. STATUS.txt counts them as "set aside".

## Posting to Swartzit

With a `publish` block in the config, every saved item is also posted to a
Swartzit community through the admin import API, dated by its original publish
date (`backdate`), so a backfill fills in history instead of flooding the top
of the timeline. YouTube items become embeds of the original video; podcast
episodes become audio posts that stream from the publisher. Only items the
archiver verified against the official channel are posted. Failed posts are
retried. The scheduler account's `SCHEDULER_HANDLE` and `SCHEDULER_PASSWORD` go
in the `env_file` (mode 0600).

## How it runs

Downloads and conversions happen in a local staging folder
(`~/.cache/swartzit-archive/<name>`). Each finished item is then copied to the
archive under temporary names and renamed into place, media last, so the
archive never shows partial files. The SQLite state and the log live in
`~/.local/state/swartzit-archive/<name>` because SQLite should not run on
network storage. Items from all sources are interleaved, newest first, with a
pause of 20–60 seconds between items. If YouTube rate-limits, the run waits 45
minutes. Sources are checked for new items every 6 hours.

`STATUS.txt` in the archive folder shows progress per source, the item in
progress, recent saves, and any problems.

## Setup (on the machine with the storage mounted)

```sh
mkdir -p ~/.local/bin ~/swartzit-archive ~/.config/swartzit-archive ~/.config/systemd/user
curl -L -o ~/.local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && chmod +x ~/.local/bin/yt-dlp
cp scripts/archive/media_archive.py ~/swartzit-archive/
cp scripts/archive/charlie-kirk.example.json ~/.config/swartzit-archive/charlie-kirk.json   # edit "root"
cp deploy/systemd-user/swartzit-media-archive@.service ~/.config/systemd/user/
loginctl enable-linger "$USER"     # keep user services running without a login
systemctl --user daemon-reload
systemctl --user enable --now swartzit-media-archive@charlie-kirk
```

Requires Python 3.10+, ffmpeg/ffprobe with libsvtav1, and yt-dlp. Keep yt-dlp
current (`yt-dlp -U`), since YouTube changes often.

Archive only what you have the right to keep, and keep personal archives
private: downloading from YouTube is outside its terms of service, and the
recordings remain their publishers' property.

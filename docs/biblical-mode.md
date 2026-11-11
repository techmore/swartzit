# Biblical mode

Biblical mode turns Swartzit into a place to read Scripture, listen to it,
and follow sermons and teaching, still in the familiar timeline layout. It is
**per visitor**: each person switches between **Standard** (everything on the
instance) and **Bible** with the switch in the header (or the menu on a
phone), and their browser remembers the choice. The admin decides whether the
mode is offered at all and which mode new visitors start in. It is **off by
default**.

## Turning it on

**Admin → Settings → Biblical mode → Offer Bible mode on this instance**, then
choose whether new visitors start in **Bible mode** or **Standard mode**.
(API: `POST /api/admin/settings` with `{"bible_enabled": true}` and
`{"bible_default": true|false}`; `GET /api/bible/config` reports
`enabled`, `default_mode`, and `communities`.)

The choice is kept in the `swartzit_mode` cookie (`standard` or `bible`).
Turning the mode off returns everyone to Standard whatever they chose.

For a visitor in Bible mode, within about 15 seconds of an admin change every page:Within about 15 seconds every page:

- uses the Reformed / Presbyterian presentation: parchment and Westminster navy
  by day, navy and gilt in dark mode, serif headings, and the burning-bush
  emblem (*nec tamen consumebatur*, Exodus 3:2) with *Soli Deo Gloria*;
- shows a **Bible** link in the header (and the mobile tab bar);
- scopes the default public timeline to four communities, created on first
  enable if they do not exist:

  | Community | Contents |
  | --- | --- |
  | `c/scripture` | Chapters with KJV text and an audio reading |
  | `c/daily_reading` | One post per day from the reading plan, every chapter queued for listening |
  | `c/sermons` | Preaching from Reformed and Presbyterian pulpits |
  | `c/deeper_dives` | Teaching, lectures, and the Westminster Shorter Catechism |

  Readers can pick **Everything** to see the rest of the instance. Picking a
  community works as before.

Switching to Standard restores the normal presentation and timeline. The four
communities and their posts stay either way.

## Reading and listening

- `/bible` — today's reading with **Listen to today's reading**, all 66 books,
  and links to sermons, deeper dives, and the catechism.
- `/bible/titus` — a book. **Listen to Titus** queues every chapter in order;
  the play button beside a chapter starts there and continues to the end.
- `/bible/titus/2` — the chapter text with **Listen** and **Listen through to
  the end of Titus**.
- `/bible/reading/2026-11-10` — the plan for a given day.
- `/bible/catechism` and `/bible/catechism/1` — the Shorter Catechism.
- `/bible/john` also embeds Westminster Abbey's filmed reading of the whole
  Gospel by Sir David Suchet (NIV). Official filmed readings are listed in
  `apps/web/src/lib/bible/readings-video.mjs`; only add uploads by the
  publisher or rights holder.

The player stays at the bottom of the screen while you move around the site,
advances through the queue, supports 0.75–2× speed, ±15/30-second skips, and
lock-screen / headphone controls. Sermons and lectures longer than ten minutes
resume where you stopped (stored in that browser only). Any post with audio
shows a listen card with **Play** and **Add to queue**. On a phone the player
sits above the tab bar and can be shrunk to a single row (the chevron) so it
covers less of the page while you read along; the page keeps enough room at the
bottom that the last verses and the next-chapter buttons are never hidden.

### Sources

- **Text:** King James Version (public domain) from `bible-api.com`, cached in
  the web process. If it is unreachable, the chapter page still offers audio
  and a link to the chapter on Bible.com.
- **Audio:** LibriVox volunteer recordings of the KJV (public domain), one MP3
  per chapter, streamed from the Internet Archive. The chapter → file map is
  checked in at `apps/web/src/lib/bible/kjv-audio.json` and regenerated with
  `python3 scripts/bible-audio-map.py`.
- **Reading plan:** built in. The Old Testament (without the Psalms) once
  through each year, plus one psalm and one New Testament chapter every day.

Swartzit does not download or rehost any of this audio; the reader's browser
streams it from the publisher.

## Filling the feed

`scripts/bible-feed.mjs` publishes through the admin import API with the same
scheduler account used by the other scheduled imports
(`SCHEDULER_HANDLE` / `SCHEDULER_PASSWORD`, or `.local/import-scheduler.env`).
Every post has a stable source URL, so reruns update rather than duplicate.
Add `--dry-run` to print the records instead of publishing.

```sh
# Today's reading plan post (links to $SWARTZIT_ORIGIN/bible/reading/<date>)
SWARTZIT_ORIGIN=https://example.org node scripts/bible-feed.mjs --job reading

# Work through a book: the next unpublished chapter each run …
node scripts/bible-feed.mjs --job book --book titus
# … or the whole book at once
node scripts/bible-feed.mjs --job book --book titus --all

# Newest sermon/teaching from each configured feed (default 1 per feed)
node scripts/bible-feed.mjs --job sermons --per-feed 2

# Next Westminster Shorter Catechism question (cycles 1–107)
SWARTZIT_ORIGIN=https://example.org node scripts/bible-feed.mjs --job catechism

# Reading + sermons + catechism, as the timer runs it
node scripts/bible-feed.mjs --job daily
```

Sermon and teaching feeds are listed in `scripts/bible/sermon-feeds.json`.
Each entry has a `name`, podcast `url`, target `community` (`sermons` or
`deeper_dives`), and optional `church`, `speaker`, and `enabled: false`. Any
public podcast RSS feed with audio enclosures works; RSS audio is accepted from
any HTTPS host as long as the URL names an audio file.

### Scheduling on a server

```sh
sudo install -m 0600 -o swartzit -g swartzit deploy/bible-feed.env.example /etc/swartzit/bible-feed.env
sudoedit /etc/swartzit/bible-feed.env    # scheduler account, API_URL, SWARTZIT_ORIGIN
sudo systemctl daemon-reload
sudo systemctl enable --now swartzit-bible-feed.timer
sudo systemctl start swartzit-bible-feed.service   # run once now
journalctl -u swartzit-bible-feed.service -n 20
```

The timer runs each morning at 05:15 (± 10 minutes). Progress through books
and the catechism is kept in `/var/lib/swartzit/state/bible-feed.json`.

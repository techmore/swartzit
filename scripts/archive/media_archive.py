#!/usr/bin/env python3
"""Offline archive of a curated set of official sources (YouTube channels and
podcast feeds) on local or network storage.

It keeps original audio and the best available video (up to 4K), preferring
YouTube's own AV1 stream. Other codecs are converted to AV1 with SVT-AV1, and
the conversion is kept only when it is clearly smaller. Every item gets a
small JSON record of where it came from (channel id, URL, upload date and a
SHA-256 of the file as downloaded), so the archive can show it is authentic.

    media_archive.py --config archive.json            # run until stopped
    media_archive.py --config archive.json --once     # one pass, then exit
    media_archive.py --config archive.json --status   # print the status file

Downloads and AV1 conversions happen in a local staging folder (fast disk),
and each finished item is copied to <root> in one go, so network storage only
ever sees complete files. The SQLite state and log stay on local disk; the
manifest and STATUS.txt (progress for people) are written to <root>. Requires yt-dlp (as a module, or the zipapp path in
the config's "yt_dlp" key) and ffmpeg/ffprobe.
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import fcntl
import hashlib
import html
import json
import os
import random
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

USER_AGENT = 'swartzit-media-archive/1 (+https://github.com/techmore/swartzit)'
STOP = False


def _stop(*_):
    global STOP
    STOP = True


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)


class RateLimited(Exception):
    """YouTube asked us to slow down; back off before trying again."""


class OffSubject(Exception):
    """The item is not the archive's subject (for example, another host on
    the subject's channel after the subject's death)."""


# --------------------------------------------------------------------- helpers

def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def safe_name(text: str, limit: int = 120) -> str:
    text = re.sub(r'[\x00-\x1f/\\:*?"<>|]+', ' ', html.unescape(text or '')).strip().rstrip('.')
    text = re.sub(r'\s+', ' ', text)
    return (text[:limit].rstrip() or 'untitled')


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def glob_escape(text: str) -> str:
    return re.sub(r'([\[\]*?])', r'[\1]', text)


def human(n: float) -> str:
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if n < 1024 or unit == 'TB':
            return f'{n:.1f} {unit}' if unit != 'B' else f'{int(n)} B'
        n /= 1024
    return f'{n:.1f} TB'


def probe(path: Path) -> dict:
    out = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', str(path)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def duration(path: Path) -> float:
    try:
        return float(probe(path)['format'].get('duration') or 0)
    except Exception:
        return 0.0


class Subject:
    """Who the archive is about. Everything published up to `until` is kept.
    After it, only titles that clearly present the subject (an archived
    speech, a debate compilation) are kept, and titles about others or about
    the subject's death are not. Without a `subject` block, everything is kept."""

    def __init__(self, config: dict | None):
        config = config or {}
        self.name = config.get('name', '')
        self.until = config.get('until')
        self.include = re.compile(config['after_title_match']) if config.get('after_title_match') else None
        self.exclude = re.compile(config['after_title_exclude']) if config.get('after_title_exclude') else None

    def keeps(self, title: str, published: str | None) -> bool | None:
        """True or False, or None while the publish date is unknown."""
        if not self.until:
            return True
        if not published:
            return None
        if published <= self.until:
            return True
        title = title or ''
        if self.exclude and self.exclude.search(title):
            return False
        return bool(self.include and self.include.search(title))


# ----------------------------------------------------------------------- state

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
  source TEXT NOT NULL,
  item TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  published TEXT,
  url TEXT NOT NULL,
  extra TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  path TEXT,
  bytes INTEGER,
  original_bytes INTEGER,
  codec TEXT,
  height INTEGER,
  converted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, item)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS posted (source TEXT NOT NULL, item TEXT NOT NULL, post_id TEXT, posted_at TEXT NOT NULL,
  PRIMARY KEY (source, item));
"""


class Publisher:
    """Posts archived items to a Swartzit community through the admin import
    API, dated by their original publish date (`backdate`), so a backfill
    fills in history instead of the top of the timeline."""

    def __init__(self, config: dict, log):
        self.origin = config['origin'].rstrip('/')
        self.community = config['community']
        self.community_info = config.get('community_info', {})
        self.sources = set(config.get('sources') or [])
        self.env_file = Path(os.path.expanduser(config.get('env_file', '~/.config/swartzit-archive/swartzit.env')))
        self.log = log
        self.token = None
        self.ready = False

    def _credentials(self):
        values = {}
        for line in self.env_file.read_text().splitlines():
            match = re.match(r'\s*(SCHEDULER_HANDLE|SCHEDULER_PASSWORD)\s*=\s*(.+?)\s*$', line)
            if match:
                values[match.group(1)] = match.group(2).strip('\'"')
        return {'handle': values.get('SCHEDULER_HANDLE', ''), 'password': values.get('SCHEDULER_PASSWORD', '')}

    def _call(self, method: str, path: str, body=None, auth=True):
        headers = {'Content-Type': 'application/json', 'User-Agent': USER_AGENT}
        if auth and self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        request = urllib.request.Request(self.origin + path, method=method, headers=headers,
                                         data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                text = response.read().decode()
                return response.status, (json.loads(text) if text else None)
        except urllib.error.HTTPError as error:
            text = error.read().decode(errors='replace')
            try:
                return error.code, json.loads(text)
            except ValueError:
                return error.code, {'error': text[:200]}

    def _login(self):
        status, data = self._call('POST', '/api/sessions', self._credentials(), auth=False)
        if status != 200 or not data or not data.get('token'):
            raise RuntimeError(f'Swartzit sign-in failed ({status})')
        self.token = data['token']

    def _prepare(self):
        if self.ready:
            return
        self._login()
        status, _ = self._call('GET', f'/api/communities/{self.community}', auth=False)
        if status == 404:
            info = {'slug': self.community, 'name': self.community_info.get('name', self.community),
                    'description': self.community_info.get('description', '')}
            status, data = self._call('POST', '/api/communities', info)
            if status not in (200, 201):
                raise RuntimeError(f'could not create c/{self.community}: {status} {data}')
            self.log(f'created c/{self.community}')
        self.ready = True

    def publish(self, record: dict) -> str | None:
        if self.sources and record['source'] not in self.sources:
            return None
        self._prepare()
        body = self._youtube(record) if record['kind'] == 'youtube' else self._podcast(record)
        status, data = self._call('POST', '/api/admin/imports', body)
        if status == 401:
            self._login()
            status, data = self._call('POST', '/api/admin/imports', body)
        if status not in (200, 201):
            raise RuntimeError(f'import failed ({status}): {data}')
        return str((data or {}).get('post_id') or (data or {}).get('id') or '')

    def remove(self, post_id: str, note: str):
        """Take a post back down (it stays in Swartzit's audit history)."""
        self._prepare()
        status, data = self._call('POST', f'/api/admin/posts/{int(post_id)}/remove', {'note': note[:1000]})
        if status == 401:
            self._login()
            status, data = self._call('POST', f'/api/admin/posts/{int(post_id)}/remove', {'note': note[:1000]})
        if status not in (200, 404):
            raise RuntimeError(f'remove failed ({status}): {data}')

    def _common(self, record: dict, published: str | None) -> dict:
        when = f'{published}T12:00:00Z' if published and re.match(r'^\d{4}-\d{2}-\d{2}$', published) else None
        return {'community': self.community, 'published_at': when, 'observed_at': now(), 'backdate': True,
                'title': (record.get('title') or 'Untitled')[:300]}

    def _youtube(self, record: dict) -> dict:
        name = record.get('channel') or 'YouTube'
        return {**self._common(record, record.get('upload_date')), 'provider': 'youtube',
                'source_url': f"https://www.youtube.com/watch?v={record['id']}",
                'source_author': name, 'profile_display_name': name,
                'body': (record.get('description') or '')[:1800], 'media': [],
                'attribution': f'From the official {name} YouTube channel.'}

    def _podcast(self, record: dict) -> dict:
        link = record.get('link') or ''
        parsed = urllib.parse.urlparse(link)
        source_url = link if parsed.scheme == 'https' and not parsed.query and not parsed.fragment else record['url']
        name = record.get('feed_name') or 'Podcast'
        description = re.sub(r'<[^>]+>', ' ', html.unescape(record.get('description') or ''))
        return {**self._common(record, record.get('published')), 'provider': 'rss',
                'source_url': source_url, 'source_author': name, 'profile_display_name': name,
                'body': re.sub(r'\s+\n', '\n', description).strip()[:1800],
                'media': [{'kind': 'audio', 'src': record['url'], 'alt': (record.get('title') or '')[:300]}],
                'attribution': f'From {name}. Audio streams from the publisher.'}


class Archive:
    def __init__(self, config: dict):
        self.config = config
        self.root = Path(os.path.expanduser(config['root']))
        slug = safe_name(config.get('name', 'archive')).lower().replace(' ', '-')
        # Local disk: SQLite does not belong on network storage, and staging
        # keeps partial downloads and conversions off the NAS.
        self.state_dir = Path(os.path.expanduser(config.get('state_dir', f'~/.local/state/swartzit-archive/{slug}')))
        self.staging = Path(os.path.expanduser(config.get('staging_dir', f'~/.cache/swartzit-archive/{slug}')))
        self.min_free = int(config.get('staging_min_free_gb', 40)) * 1024 ** 3
        self.public_dir = self.root / '_archive'
        for folder in (self.state_dir, self.staging, self.public_dir):
            folder.mkdir(parents=True, exist_ok=True)
        old_db = self.public_dir / 'archive.sqlite'
        if old_db.exists() and not (self.state_dir / 'archive.sqlite').exists():
            shutil.move(str(old_db), self.state_dir / 'archive.sqlite')
        self.db = sqlite3.connect(self.state_dir / 'archive.sqlite')
        self.db.executescript(SCHEMA)
        self.log_file = open(self.state_dir / 'archive.log', 'a', buffering=1)
        self.current = ''
        self.sources = {s['id']: s for s in config['sources']}
        self._ydl_module = None
        self.publisher = Publisher(config['publish'], self.log) if config.get('publish') else None
        self.subject = Subject(config.get('subject'))

    # -- logging and status
    def log(self, message: str):
        line = f'{now()} {message}'
        print(line, flush=True)
        self.log_file.write(line + '\n')

    def write_status(self, note: str = ''):
        rows = self.db.execute(
            "SELECT source, status, COUNT(*), COALESCE(SUM(bytes),0) FROM items GROUP BY source, status").fetchall()
        by = {}
        for source, status, count, size in rows:
            entry = by.setdefault(source, {'pending': 0, 'done': 0, 'failed': 0, 'skipped': 0, 'bytes': 0})
            entry[status] = count
            if status == 'done':
                entry['bytes'] += size
        total_done = sum(v['done'] for v in by.values())
        total_all = sum(v['done'] + v['pending'] + v['failed'] for v in by.values())
        total_bytes = sum(v['bytes'] for v in by.values())
        saved = self.db.execute("SELECT COALESCE(SUM(original_bytes - bytes),0), COUNT(*) FROM items WHERE converted = 1").fetchone()
        recent = self.db.execute(
            "SELECT updated_at, source, title, bytes, codec, height, converted FROM items WHERE status='done' ORDER BY updated_at DESC LIMIT 12").fetchall()
        failed = self.db.execute(
            "SELECT source, title, error FROM items WHERE status='failed' ORDER BY updated_at DESC LIMIT 5").fetchall()
        lines = [
            f"{self.config.get('name', 'Media archive')}",
            '=' * 60,
            f'Updated: {dt.datetime.now().strftime("%A %d %B %Y, %I:%M %p")}',
            f'Progress: {total_done} of {total_all} items saved ({human(total_bytes)})',
        ]
        if saved[1]:
            lines.append(f'AV1 conversions: {saved[1]} items, {human(saved[0])} saved')
        lines += [f'Now: {self.current or "waiting"}', '']
        if note:
            lines += [note, '']
        lines.append('By source:')
        for source_id, source in self.sources.items():
            v = by.get(source_id, {'pending': 0, 'done': 0, 'failed': 0, 'skipped': 0, 'bytes': 0})
            lines.append(f"  {source.get('name', source_id)}: {v['done']} saved, {v['pending']} to go"
                         f"{', ' + str(v['failed']) + ' failed' if v['failed'] else ''}"
                         f"{', ' + str(v['skipped']) + ' set aside' if v['skipped'] else ''} - {human(v['bytes'])}"
                         f"  [{source.get('folder', '')}]")
        lines += ['', 'Recently saved:']
        for when, source, title, size, codec, height, converted in recent:
            what = f"{height}p {codec}{' (converted)' if converted else ''}" if height else (codec or 'audio')
            lines.append(f"  {when[:16].replace('T', ' ')}  {title[:70]}  - {what}, {human(size or 0)}")
        if failed:
            lines += ['', 'Recent problems (retried later):']
            for source, title, error in failed:
                lines.append(f'  {title[:60]}: {(error or "")[:100]}')
        lines += ['', 'Folders are organised by source and year. Each file has a .json',
                  'record of its original URL, channel, date and SHA-256 checksum.']
        tmp = self.root / '.STATUS.txt.tmp'
        tmp.write_text('\n'.join(lines) + '\n')
        tmp.replace(self.root / 'STATUS.txt')

    # -- yt-dlp
    def ydl(self):
        if self._ydl_module is None:
            zipapp = os.path.expanduser(self.config.get('yt_dlp', '~/.local/bin/yt-dlp'))
            if os.path.exists(zipapp):
                sys.path.insert(0, zipapp)
            import yt_dlp  # noqa: E402
            self._ydl_module = yt_dlp
        return self._ydl_module

    # -- discovery
    def upsert(self, source: str, item: str, title: str, published: str | None, url: str, extra: dict | None = None):
        self.db.execute(
            "INSERT INTO items(source,item,title,published,url,extra,discovered_at,updated_at) VALUES (?,?,?,?,?,?,?,?) "
            "ON CONFLICT(source,item) DO UPDATE SET title=excluded.title, url=excluded.url, "
            "published=COALESCE(excluded.published, items.published)",
            (source, item, title, published, url, json.dumps(extra or {}), now(), now()))

    def discover(self):
        for source in self.config['sources']:
            if STOP:
                return
            try:
                count = self.discover_youtube(source) if source['kind'] == 'youtube' else self.discover_podcast(source)
                self.db.commit()
                self.log(f"discovered {count} items in {source.get('name', source['id'])}")
            except RateLimited:
                raise
            except Exception as error:  # keep other sources going
                self.log(f"discovery failed for {source['id']}: {error}")
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('discovered_at', ?)", (now(),))
        self.db.commit()

    def discover_youtube(self, source: dict) -> int:
        yt_dlp = self.ydl()
        opts = {'extract_flat': 'in_playlist', 'quiet': True, 'no_warnings': True, 'skip_download': True,
                'sleep_interval_requests': 1}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = self._guard(lambda: ydl.extract_info(source['url'], download=False))
        expected = source.get('channel_id')
        if expected and info.get('channel_id') != expected:
            raise RuntimeError(f"{source['url']} belongs to {info.get('channel_id')}, not the official channel {expected}")
        match = re.compile(source['title_match']) if source.get('title_match') else None
        count = 0
        for entry in info.get('entries') or []:
            if not entry or not entry.get('id'):
                continue
            title = entry.get('title') or ''
            if match and not match.search(title):
                continue
            self.upsert(source['id'], entry['id'], title, None, f"https://www.youtube.com/watch?v={entry['id']}",
                        {'duration': entry.get('duration')})
            count += 1
        return count

    def discover_podcast(self, source: dict) -> int:
        request = urllib.request.Request(source['url'], headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            root = ET.fromstring(response.read())
        count = 0
        for node in root.iter('item'):
            enclosure = node.find('enclosure')
            if enclosure is None or not enclosure.get('url'):
                continue
            guid = (node.findtext('guid') or enclosure.get('url')).strip()
            item_id = hashlib.sha1(guid.encode()).hexdigest()[:16]
            published = None
            if node.findtext('pubDate'):
                try:
                    published = email.utils.parsedate_to_datetime(node.findtext('pubDate')).astimezone(dt.timezone.utc).strftime('%Y-%m-%d')
                except Exception:
                    published = None
            self.upsert(source['id'], item_id, (node.findtext('title') or '').strip(), published, enclosure.get('url'),
                        {'guid': guid, 'link': node.findtext('link'), 'description': (node.findtext('description') or '')[:20000],
                         'type': enclosure.get('type'), 'length': enclosure.get('length')})
            count += 1
        return count

    def _guard(self, fn):
        try:
            return fn()
        except Exception as error:
            text = str(error)
            if '429' in text or 'Too Many Requests' in text or 'confirm you' in text.lower():
                raise RateLimited(text) from error
            raise

    # -- downloading
    def next_item(self):
        # Interleave sources so every collection makes progress; newest first.
        return self.db.execute(
            "SELECT source, item, title, published, url, extra, attempts FROM items "
            "WHERE status='pending' OR (status='failed' AND attempts < 4 AND updated_at < ?) "
            "ORDER BY attempts, (SELECT COUNT(*) FROM items d WHERE d.source = items.source AND d.status='done'), "
            "COALESCE(published, '') DESC, rowid LIMIT 1",
            ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)).strftime('%Y-%m-%dT%H:%M:%SZ'),)).fetchone()

    def finish(self, source, item, **fields):
        fields['updated_at'] = now()
        sets = ', '.join(f'{k}=?' for k in fields)
        self.db.execute(f'UPDATE items SET {sets} WHERE source=? AND item=?', (*fields.values(), source, item))
        self.db.commit()

    def manifest(self, record: dict):
        with open(self.public_dir / 'manifest.jsonl', 'a') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

    def process(self, row):
        source_id, item, title, published, url, extra, attempts = row
        source = self.sources.get(source_id)
        if source is None:
            self.finish(source_id, item, status='skipped', error='source removed from config')
            return
        if self.subject.keeps(title, published) is False:
            self.finish(source_id, item, status='skipped', error=f'not {self.subject.name or "the subject"}')
            return 'skipped'
        self.current = f"{source.get('name', source_id)}: {title}"
        self.write_status()
        self.finish(source_id, item, attempts=attempts + 1)
        try:
            if source['kind'] == 'youtube':
                result = self.save_youtube(source, item, url)
            else:
                result = self.save_podcast(source, item, title, published, url, json.loads(extra or '{}'))
            self.finish(source_id, item, status='done', error=None, **result)
            self.log(f"saved {title} -> {result['path']} ({human(result['bytes'])})")
            self.post(source_id, item, getattr(self, 'last_record', None))
        except OffSubject as reason:
            self.finish(source_id, item, status='skipped', error=str(reason)[:500])
            self.log(f'set aside {title}: {reason}')
            return 'skipped'
        except RateLimited:
            self.finish(source_id, item, status='pending', attempts=attempts)
            raise
        except Exception as error:
            self.finish(source_id, item, status='failed', error=str(error)[:500])
            self.log(f'failed {title}: {error}')
        finally:
            self.current = ''

    def post(self, source_id: str, item: str, record: dict | None):
        """Post a saved item to Swartzit; failures are retried by catch_up()."""
        if not self.publisher or not record:
            return
        source = self.sources.get(source_id, {})
        record = {**record, 'feed_name': record.get('feed_name') or source.get('feed_name') or source.get('name')}
        if self.db.execute('SELECT 1 FROM posted WHERE source=? AND item=?', (source_id, item)).fetchone():
            return
        try:
            post_id = self.publisher.publish(record)
            if post_id is not None:
                self.db.execute('INSERT OR REPLACE INTO posted VALUES (?,?,?,?)', (source_id, item, post_id, now()))
                self.db.commit()
        except Exception as error:
            self.log(f"posting {record.get('title')} to Swartzit failed (will retry): {str(error)[:200]}")

    def catch_up(self, limit: int = 10):
        """Post items that were saved but not yet posted (earlier failures, or
        items archived before publishing was configured)."""
        if not self.publisher:
            return
        rows = self.db.execute(
            "SELECT i.source, i.item, i.path FROM items i LEFT JOIN posted p ON p.source=i.source AND p.item=i.item "
            "WHERE i.status='done' AND p.item IS NULL ORDER BY i.updated_at DESC LIMIT ?", (limit,)).fetchall()
        for source_id, item, path in rows:
            sidecar = (self.root / path).with_suffix('.json') if path else None
            if sidecar and sidecar.exists():
                self.post(source_id, item, json.loads(sidecar.read_text()))

    def save_youtube(self, source: dict, item: str, url: str) -> dict:
        yt_dlp = self.ydl()
        video = self.config.get('video', {})
        height = int(video.get('max_height', 2160))
        original = 'ba[format_note*=original]/ba[language^=en]/ba'
        # The highest resolution available (up to 4K); among equal resolutions
        # YouTube's own AV1 stream wins, so most videos need no conversion.
        selector = f'bv*[height<={height}]+({original})/b[height<={height}]/b'
        self.ensure_space()
        work = Path(tempfile.mkdtemp(dir=self.staging))
        try:
            opts = {
                'format': selector,
                'format_sort': [f'res:{height}', 'vcodec:av01', 'fps'],
                'merge_output_format': 'mkv',
                'outtmpl': str(work / 'media.%(ext)s'),
                'writethumbnail': True,
                'quiet': True, 'no_warnings': True, 'noprogress': True,
                'sleep_interval_requests': 1,
                'retries': 5, 'fragment_retries': 10,
                'postprocessors': [{'key': 'FFmpegMetadata', 'add_metadata': True}],
            }
            with yt_dlp.YoutubeDL(opts) as ydl:
                # Look before downloading: the channel and the subject rule
                # are checked on the metadata alone.
                info = self._guard(lambda: ydl.extract_info(url, download=False))
                expected = source.get('channel_id')
                if expected and info.get('channel_id') != expected:
                    raise RuntimeError(f"video is from channel {info.get('channel_id')}, not {expected}")
                date = info.get('upload_date') or ''
                day = f'{date[:4]}-{date[4:6]}-{date[6:]}' if len(date) == 8 else None
                if day:
                    self.db.execute('UPDATE items SET published=? WHERE source=? AND item=?', (day, source['id'], item))
                if self.subject.keeps(info.get('title') or '', day) is False:
                    raise OffSubject(f'not {self.subject.name or "the subject"} ({day})')
                info = self._guard(lambda: ydl.process_ie_result(info, download=True))
            media = next((p for p in work.iterdir() if p.name.startswith('media.') and p.suffix in ('.mkv', '.mp4', '.webm')), None)
            if media is None:
                raise RuntimeError('download produced no media file')
            original_sha = sha256(media)
            original_bytes = media.stat().st_size
            stream = next((s for s in probe(media)['streams'] if s.get('codec_type') == 'video'), {})
            codec = stream.get('codec_name', '')
            converted = False
            if codec != 'av1' and video.get('convert', True):
                converted_path = self.convert(media, work)
                if converted_path is not None:
                    media.unlink()
                    media = converted_path
                    converted = True
            date = info.get('upload_date') or '00000000'
            day = f'{date[:4]}-{date[4:6]}-{date[6:]}'
            folder = self.root / source['folder'] / date[:4]
            base = f"{day} {safe_name(info.get('title') or item)} [{item}]"
            out = work / 'out'
            out.mkdir()
            staged = out / f'{base}.mkv'
            shutil.move(str(media), staged)
            thumb = next((p for p in work.iterdir() if p.suffix in ('.webp', '.jpg', '.png')), None)
            if thumb:
                shutil.move(str(thumb), out / f'{base}{thumb.suffix}')
            final = folder / staged.name
            record = {
                'archived_at': now(), 'source': source['id'], 'kind': 'youtube',
                'id': item, 'url': info.get('webpage_url') or url, 'title': info.get('title'),
                'channel': info.get('channel'), 'channel_id': info.get('channel_id'),
                'uploader_id': info.get('uploader_id'), 'upload_date': day,
                'duration': info.get('duration'), 'description': info.get('description'),
                'tags': info.get('tags'), 'chapters': info.get('chapters'),
                'view_count_at_archive': info.get('view_count'),
                'downloaded_format': info.get('format'), 'audio_language': info.get('language'),
                'original_sha256': original_sha, 'original_bytes': original_bytes, 'original_codec': codec,
                'converted_to_av1': converted, 'file': final.name, 'sha256': sha256(staged),
            }
            (out / f'{base}.json').write_text(json.dumps(record, ensure_ascii=False, indent=1))
            self.fetch_captions(url, out, base)
            self.publish(out, folder)
            self.manifest(record)
            self.last_record = record
            return {'path': str(final.relative_to(self.root)), 'bytes': final.stat().st_size,
                    'original_bytes': original_bytes, 'codec': 'av1' if converted else codec,
                    'height': stream.get('height'), 'converted': int(converted), 'published': day}
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def convert(self, media: Path, work: Path) -> Path | None:
        """SVT-AV1 at low priority; keep only if clearly smaller and complete."""
        settings = self.config.get('video', {}).get('av1', {})
        out = work / 'av1.mkv'
        command = ['nice', '-n', '15', 'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(media),
                   '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0', '-c:v', 'libsvtav1',
                   '-preset', str(settings.get('preset', 8)), '-crf', str(settings.get('crf', 33)), '-g', '240',
                   '-pix_fmt', 'yuv420p10le', '-svtav1-params', f"lp={settings.get('threads', 6)}",
                   '-c:a', 'copy', str(out)]
        self.log(f'converting {media.name} to AV1')
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0 or not out.exists():
            self.log(f'conversion failed, keeping original: {result.stderr[-300:]}')
            return None
        if abs(duration(out) - duration(media)) > 2:
            self.log('conversion length mismatch, keeping original')
            return None
        ratio = out.stat().st_size / max(1, media.stat().st_size)
        if ratio > float(settings.get('keep_if_ratio_below', 0.8)):
            self.log(f'conversion only {ratio:.0%} of original, keeping original')
            out.unlink()
            return None
        return out

    def ensure_space(self):
        free = shutil.disk_usage(self.staging).free
        if free < self.min_free:
            raise RuntimeError(f'staging disk has only {human(free)} free; need {human(self.min_free)}')

    def publish(self, staged_dir: Path, folder: Path):
        """Copy a finished item to the archive: each file is written under a
        temporary name and renamed, the media file last, so the archive never
        shows a partial file."""
        folder.mkdir(parents=True, exist_ok=True)
        files = sorted((p for p in staged_dir.iterdir() if p.is_file()),
                       key=lambda p: p.suffix in ('.mkv', '.mp3', '.m4a', '.mp4'))
        for path in files:
            target = folder / path.name
            part = folder / f'.{path.name}.part'
            shutil.copyfile(path, part)
            if part.stat().st_size != path.stat().st_size:
                part.unlink(missing_ok=True)
                raise RuntimeError(f'copy of {path.name} to the archive was incomplete')
            os.replace(part, target)

    def fetch_captions(self, url: str, folder: Path, base: str):
        """Best effort: English captions as text, never fatal."""
        if not self.config.get('video', {}).get('captions', True):
            return
        yt_dlp = self.ydl()
        try:
            time.sleep(5)
            opts = {'skip_download': True, 'writesubtitles': True, 'writeautomaticsub': True,
                    'subtitleslangs': ['en', 'en-US', 'en-orig'], 'subtitlesformat': 'vtt',
                    'outtmpl': str(folder / f'{base}.%(ext)s'), 'quiet': True, 'no_warnings': True,
                    'ignoreerrors': True}
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except Exception as error:
            self.log(f'captions skipped: {str(error)[:120]}')

    def save_podcast(self, source: dict, item: str, title: str, published: str | None, url: str, extra: dict) -> dict:
        year = (published or '0000')[:4]
        folder = self.root / source['folder'] / year
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or '.mp3'
        base = f"{published or 'undated'} {safe_name(title)} [{item[:8]}]"
        self.ensure_space()
        work = Path(tempfile.mkdtemp(dir=self.staging))
        try:
            staged = work / f'{base}{ext}'
            request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(request, timeout=300) as response, open(staged, 'wb') as f:
                shutil.copyfileobj(response, f, 1 << 20)
            if staged.stat().st_size < 10_000:
                raise RuntimeError('download too small to be an episode')
            size = staged.stat().st_size
            record = {'archived_at': now(), 'source': source['id'], 'kind': 'podcast', 'feed': source['url'],
                      'feed_name': source.get('feed_name') or source.get('name'),
                      'title': title, 'published': published, 'url': url, 'guid': extra.get('guid'),
                      'link': extra.get('link'), 'description': extra.get('description'),
                      'file': staged.name, 'sha256': sha256(staged), 'bytes': size}
            (work / f'{base}.json').write_text(json.dumps(record, ensure_ascii=False, indent=1))
            self.publish(work, folder)
            self.manifest(record)
            final = folder / staged.name
            self.last_record = record
            return {'path': str(final.relative_to(self.root)), 'bytes': size,
                    'original_bytes': size, 'codec': ext.lstrip('.'), 'height': None, 'converted': 0}
        finally:
            shutil.rmtree(work, ignore_errors=True)

    # -- applying the subject rule to what is already saved
    def apply_subject(self, dry_run: bool) -> dict:
        """Set aside saved items the subject rule no longer keeps: their files
        move to a `_Set aside` folder (nothing is deleted), their Swartzit
        posts are taken down, and pending items with known dates are skipped."""
        name = self.subject.name or 'the subject'
        aside_root = self.root / f'_Set aside (not {safe_name(name)})'
        counts = {'set_aside': 0, 'posts_removed': 0, 'skipped_pending': 0, 'bytes': 0}
        rows = self.db.execute(
            "SELECT source, item, title, published, path, bytes FROM items WHERE status IN ('done','pending','failed')").fetchall()
        for source_id, item, title, published, path, size in rows:
            if self.subject.keeps(title, published) is not False:
                continue
            if not path:
                counts['skipped_pending'] += 1
                if not dry_run:
                    self.finish(source_id, item, status='skipped', error=f'not {name}')
                continue
            counts['set_aside'] += 1
            counts['bytes'] += size or 0
            if dry_run:
                print(f'would set aside: {published} {title}')
                continue
            media = self.root / path
            target_dir = aside_root / Path(path).parent
            target_dir.mkdir(parents=True, exist_ok=True)
            stem = media.stem
            for sibling in list(media.parent.glob(glob_escape(stem) + '.*')):
                shutil.move(str(sibling), target_dir / sibling.name)
            posted = self.db.execute('SELECT post_id FROM posted WHERE source=? AND item=?', (source_id, item)).fetchone()
            if posted and posted[0] and self.publisher:
                self.publisher.remove(posted[0], f'Not {name}')
                counts['posts_removed'] += 1
            self.db.execute('DELETE FROM posted WHERE source=? AND item=?', (source_id, item))
            self.finish(source_id, item, status='skipped', error=f'not {name}; set aside',
                        path=str((target_dir / media.name).relative_to(self.root)))
            self.log(f'set aside {title}')
        self.db.commit()
        if not dry_run:
            self.write_status()
        return counts

    # -- main loop
    def run(self, once: bool):
        pace = self.config.get('pace', {})
        rediscover = float(pace.get('rediscover_hours', 6)) * 3600
        low, high = pace.get('between_items_seconds', [20, 60])
        last = self.db.execute("SELECT value FROM meta WHERE key='discovered_at'").fetchone()
        last_discovery = 0.0 if not last else dt.datetime.strptime(last[0], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc).timestamp()
        while not STOP:
            try:
                if time.time() - last_discovery > rediscover:
                    self.current = 'checking sources for new items'
                    self.write_status()
                    self.discover()
                    last_discovery = time.time()
                row = self.next_item()
                if row is None:
                    self.current = ''
                    self.write_status('Everything found so far is saved. Checking again for new items later.')
                    if once:
                        return
                    for _ in range(600):
                        if STOP:
                            return
                        time.sleep(1)
                    continue
                if self.process(row) == 'skipped':
                    # Nothing was downloaded; a short pause is polite enough.
                    time.sleep(random.uniform(2, 5))
                    continue
                self.catch_up()
                self.write_status()
                if once and self.db.execute("SELECT COUNT(*) FROM items WHERE status='pending'").fetchone()[0] == 0:
                    return
                time.sleep(random.uniform(low, high))
            except RateLimited as error:
                wait = int(pace.get('rate_limit_backoff_minutes', 45))
                self.current = ''
                self.write_status(f'YouTube asked us to slow down; pausing {wait} minutes.')
                self.log(f'rate limited, pausing {wait} min: {str(error)[:200]}')
                if once:
                    return
                for _ in range(wait * 60):
                    if STOP:
                        return
                    time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', required=True)
    parser.add_argument('--once', action='store_true', help='one pass through pending items, then exit')
    parser.add_argument('--discover', action='store_true', help='only refresh the item lists')
    parser.add_argument('--status', action='store_true', help='print STATUS.txt')
    parser.add_argument('--apply-subject', action='store_true',
                        help='set aside saved items the subject rule does not keep, and take down their posts')
    parser.add_argument('--dry-run', action='store_true', help='with --apply-subject: only list what would change')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    archive = Archive(config)
    if args.status:
        archive.write_status()
        print((archive.root / 'STATUS.txt').read_text())
        return
    lock = open(archive.state_dir / 'archive.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit('Another archive run is already in progress.')
    if args.apply_subject:
        print(json.dumps(archive.apply_subject(args.dry_run)))
        return
    if args.discover:
        archive.discover()
        archive.write_status()
        return
    archive.log('archive run started')
    archive.run(args.once)
    archive.current = ''
    archive.write_status('Paused.' if STOP else '')
    archive.log('archive run stopped')


if __name__ == '__main__':
    main()

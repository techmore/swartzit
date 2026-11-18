#!/usr/bin/env python3
"""Regenerate apps/web/src/lib/bible/kjv-audio.json from LibriVox on archive.org.

    python3 scripts/bible-audio-map.py [--cache .local/bible-audio-cache]

Each book maps to one public-domain LibriVox King James recording. Files often
cover several chapters ("Titus - Chapters 1 - 3"), so the output lists
segments of consecutive chapters. Every chapter of every book must be covered,
or the script exits nonzero and leaves the checked-in map unchanged.
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps/web/src/lib/bible/kjv-audio.json")
UA = "swartzit-bible-audio-map/1.0"

# (book, chapters) in canonical order; must match apps/web/src/lib/bible/books.mjs.
BOOKS = [
    ("Genesis", 50), ("Exodus", 40), ("Leviticus", 27), ("Numbers", 36), ("Deuteronomy", 34),
    ("Joshua", 24), ("Judges", 21), ("Ruth", 4), ("1 Samuel", 31), ("2 Samuel", 24),
    ("1 Kings", 22), ("2 Kings", 25), ("1 Chronicles", 29), ("2 Chronicles", 36), ("Ezra", 10),
    ("Nehemiah", 13), ("Esther", 10), ("Job", 42), ("Psalms", 150), ("Proverbs", 31),
    ("Ecclesiastes", 12), ("Song of Solomon", 8), ("Isaiah", 66), ("Jeremiah", 52),
    ("Lamentations", 5), ("Ezekiel", 48), ("Daniel", 12), ("Hosea", 14), ("Joel", 3), ("Amos", 9),
    ("Obadiah", 1), ("Jonah", 4), ("Micah", 7), ("Nahum", 3), ("Habakkuk", 3), ("Zephaniah", 3),
    ("Haggai", 2), ("Zechariah", 14), ("Malachi", 4),
    ("Matthew", 28), ("Mark", 16), ("Luke", 24), ("John", 21), ("Acts", 28), ("Romans", 16),
    ("1 Corinthians", 16), ("2 Corinthians", 13), ("Galatians", 6), ("Ephesians", 6),
    ("Philippians", 4), ("Colossians", 4), ("1 Thessalonians", 5), ("2 Thessalonians", 3),
    ("1 Timothy", 6), ("2 Timothy", 4), ("Titus", 3), ("Philemon", 1), ("Hebrews", 13),
    ("James", 5), ("1 Peter", 5), ("2 Peter", 3), ("1 John", 5), ("2 John", 1), ("3 John", 1),
    ("Jude", 1), ("Revelation", 22),
]

# book -> (archive.org identifier, label used in track titles of multi-book
# items or None, notes, alternates)
SEL = {
    "Genesis": ("bible_kjv_01_02_03_0908_librivox", "Genesis", "Solo reader; 4-6 chapters per file.", ["bible_kjv_complete_2001_librivox"]),
    "Exodus": ("bible_kjv_01_02_03_0908_librivox", "Exodus", "Solo reader; 4-6 chapters per file.", ["bible_kjv_complete_2001_librivox"]),
    "Leviticus": ("bible_kjv_01_02_03_0908_librivox", "Leviticus", "Solo reader; 3-6 chapters per file.", ["bible_kjv_complete_2001_librivox"]),
    "Numbers": ("numbers_kjv_1108_librivox", None, "Multiple volunteer readers; 2-4 chapters per file.", []),
    "Deuteronomy": ("deuteronomy_kjv_1110_librivox", None, "Multiple volunteer readers; 1-3 chapters per file.", []),
    "Joshua": ("bible_kjv_joshua_jc_librivox", None, "", []),
    "Judges": ("bible_judges_kjv_jc_librivox", None, "", []),
    "Ruth": ("bible_ruth_tg_librivox", None, "Single file for whole book (solo). A dramatic version exists.", ["biblekjv_8ruth_dr_1502_librivox"]),
    "1 Samuel": ("bible_1samuel_kjv_0903_librivox", None, "", []),
    "2 Samuel": ("bible_2samuel_kjv_jc_librivox", None, "", []),
    "1 Kings": ("bible_kjv_11_1king_0909_librivox", None, "", []),
    "2 Kings": ("bible_kjv_2kings_jc_librivox", None, "", []),
    "1 Chronicles": ("1chronicles_jc_librivox", None, "", []),
    "2 Chronicles": ("2chronicleskjv_1403_librivox", None, "", ["bible_kjv_14_2chronicles_1110_librivox"]),
    "Ezra": ("ezra_kjv_sw_librivox", None, "2 chapters per file.", []),
    "Nehemiah": ("nehemiah_kjv_1110_librivox", None, "2-3 chapters per file.", []),
    "Esther": ("publicdomain", None, "Solo reading, 3 files. A per-chapter DRAMATIC version exists (bible_kjv_17_esther_dr_1502_librivox: ch 1 includes cast credits, ch 9-10 combined).", ["bible_kjv_17_esther_dr_1502_librivox"]),
    "Job": ("bible_kjv_18_job_version_2_1507_librivox", None, "Solo (version 2).", ["job_kjv_1012_librivox", "job_1612_librivox"]),
    "Psalms": ("bible_kjv_19_psalms_1207_librivox", None, "No per-psalm LibriVox KJV recording exists; this is the finest split (50 files of 1-8 psalms). Track 13 is labelled 'Psalms 39, 40' and track 14 'Psalms 40, 41' (Psalm 40 straddles files; mapped to track 13).", ["psalms_kjv_1202_librivox"]),
    "Proverbs": ("proverbs_kjv_mp_librivox", None, "", []),
    "Ecclesiastes": ("ecclesiastes_kjv_1105_librivox", None, "3 chapters per file.", []),
    "Song of Solomon": ("songofsolomon_kjv_1009_librivox", None, "4 chapters per file.", []),
    "Isaiah": ("isaiah_kjv_1107_librivox", None, "3 chapters per file; multiple readers.", []),
    "Jeremiah": ("jeremiah_kjv_1201_librivox", None, "2-4 chapters per file; multiple readers.", []),
    "Lamentations": ("bible_kjv_25_lamentations_mp_0909_librivox", None, "", []),
    "Ezekiel": ("ezekiel_kjv_jr_librivox", None, "4 chapters per file; solo.", []),
    "Daniel": ("daniel_kjv_1112_librivox", None, "2 chapters per file; multiple readers.", []),
    "Hosea": ("minor_prophets_tg_librivox", "Hosea", "Minor Prophets volume, solo reader.", []),
    "Joel": ("minor_prophets_tg_librivox", "Joel", "Whole book in one file.", ["joel_kjv_ss_librivox"]),
    "Amos": ("minor_prophets_tg_librivox", "Amos", "", []),
    "Obadiah": ("minor_prophets_tg_librivox", "Obadiah", "", []),
    "Jonah": ("minor_prophets_tg_librivox", "Jonah", "Whole book in one file.", []),
    "Micah": ("minor_prophets_tg_librivox", "Micah", "", []),
    "Nahum": ("minor_prophets_tg_librivox", "Nahum", "Whole book in one file.", []),
    "Habakkuk": ("minor_prophets_tg_librivox", "Habakkuk", "Whole book in one file.", []),
    "Zephaniah": ("minor_prophets_tg_librivox", "Zephaniah", "Whole book in one file.", []),
    "Haggai": ("minor_prophets_tg_librivox", "Haggai", "Whole book in one file.", []),
    "Zechariah": ("minor_prophets_tg_librivox", "Zechariah", "", []),
    "Malachi": ("minor_prophets_tg_librivox", "Malachi", "Whole book in one file.", []),
    "Matthew": ("matthew_kjv_mp_librivox", None, "", []),
    "Mark": ("mark_kjv_sw_librivox", None, "2 chapters per file; solo.", []),
    "Luke": ("bible_kjv_nt_03_luke_0812_librivox", None, "2 chapters per file; multiple readers.", []),
    "John": ("biblent04_john_kjv_librivox", None, "Only 5 files (3-5 chapters each); multiple readers. No per-chapter LibriVox KJV John exists.", ["bible_kjv_complete_2001_librivox"]),
    "Acts": ("acts_kjv_v2_1401_librivox", None, "2 chapters per file.", ["acts_kjv_1112_librivox"]),
    "Romans": ("romans_kjv_1408_librivox", None, "Solo (version 2).", ["romans_kjv_1103_librivox"]),
    "1 Corinthians": ("1corinthians_kjv_1103_librivox", None, "2 chapters per file.", []),
    "2 Corinthians": ("2corinthians_kjv_1105_librivox", None, "1-2 chapters per file; solo.", []),
    "Galatians": ("galatians_kjv_1412_librivox", None, "Solo.", ["bible_4epistles_kjv_1104_librivox"]),
    "Ephesians": ("bible_4epistles_kjv_1104_librivox", "Ephesians", "From 'Galatians, Ephesians, Philippians, Colossians' volume; 3 chapters per file.", ["ephesians_kjv_nt_librivox"]),
    "Philippians": ("philippians_kjv_vm_librivox", None, "Solo.", ["bible_4epistles_kjv_1104_librivox"]),
    "Colossians": ("bible_4epistles_kjv_1104_librivox", "Colossians", "Whole book in one file (only LibriVox KJV Colossians).", []),
    "1 Thessalonians": ("bible_1thessalonians_kjv_1010_librivox", None, "Whole book in one file.", []),
    "2 Thessalonians": ("bible_2thessalonians_kjv_1011_librivox", None, "Whole book in one file.", []),
    "1 Timothy": ("bible_1timothy_kjv_1007_librivox", None, "2 files (ch 1-3, 4-6).", []),
    "2 Timothy": ("bible_2timothy_kjv_1009_librivox", None, "Whole book in one file.", []),
    "Titus": ("bible_titus_kjv_1007_librivox", None, "Whole book (3 chapters) in one file.", []),
    "Philemon": ("bible_philemon_kjv_1007_librivox", None, "", []),
    "Hebrews": ("hebrews_kjv_1111_librivox", None, "2-3 chapters per file.", []),
    "James": ("james_kjv", None, "Whole book in one file.", []),
    "1 Peter": ("epistlesofpeter_kjv_1109_librivox", "1 Peter", "Whole book in one file.", []),
    "2 Peter": ("epistlesofpeter_kjv_1109_librivox", "2 Peter", "Whole book in one file.", []),
    "1 John": ("bible_epistlesjohn_rt_librivox", "1 John", "Solo.", ["1John_kjv_librivox"]),
    "2 John": ("bible_epistlesjohn_rt_librivox", "2 John", "", []),
    "3 John": ("bible_epistlesjohn_rt_librivox", "3 John", "", []),
    "Jude": ("jude_kjv", None, "", []),
    "Revelation": ("revelation_mp_librivox", None, "Solo.", ["bible_kjvnt_27_revelation_1401_librivox"]),
}



def fetch_json(url, cache_dir, name):
    path = os.path.join(cache_dir, name) if cache_dir else None
    if path and os.path.exists(path) and os.path.getsize(path):
        with open(path) as f:
            return json.load(f)
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)
    return data


def librivox_readers(project_id, cache_dir):
    if not project_id:
        return {}
    try:
        d = fetch_json(f"https://librivox.org/api/feed/audiobooks/?id={project_id}&format=json&extended=1", cache_dir, f"lv-{project_id}.json")
        return {os.path.basename(urllib.parse.urlparse(s["listen_url"]).path): [r["display_name"] for r in s.get("readers", [])] for s in d["books"][0]["sections"]}
    except Exception as error:  # noqa: BLE001 - readers are optional credits
        print(f"warning: LibriVox readers for {project_id}: {error}", file=sys.stderr)
        return {}


def seconds(length):
    if length is None:
        return None
    total = 0.0
    for part in str(length).split(":"):
        total = total * 60 + float(part)
    return int(round(total))


def parse_range(title, label, book, chapters):
    t = re.sub(r"^\s*\d+[a-z]?\s*-\s*", "", title.strip())   # "01a - " track prefix
    t = re.sub(r"^Chapter\s+\d+\s*-\s*(?=Psalm)", "", t)      # "Chapter 12 - Psalms 37, 38"
    if label:
        if not re.search(r"(^|\W)" + re.escape(label) + r"(\W|$)", t):
            return None
        t = re.sub(re.escape(label), " ", t)
    nums = [int(x) for x in re.findall(r"\d+", t)]
    if not nums:
        return (1, chapters)
    if len(nums) <= 2:
        return (nums[0], nums[-1])
    raise ValueError(f"unparseable track title {title!r} for {book}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cache", default=os.path.join(ROOT, ".local/bible-audio-cache"))
    args = parser.parse_args()
    books, problems = [], []
    for book, chapters in BOOKS:
        ident, label, _note, _alternates = SEL[book]
        item = fetch_json(f"https://archive.org/metadata/{ident}", args.cache, f"ia-{ident}.json")
        readers = librivox_readers(item["metadata"].get("call_number"), args.cache)
        segments = []
        for f in sorted((f for f in item["files"] if f.get("format") == "64Kbps MP3"), key=lambda f: f["name"]):
            r = parse_range(f.get("title") or f["name"], label, book, chapters)
            if r is None:
                continue
            if not 1 <= r[0] <= r[1] <= chapters:
                problems.append(f"{book}: bad range {r} from {f.get('title')!r}")
                continue
            segments.append({"start": r[0], "end": r[1], "url": f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}", "seconds": seconds(f.get("length")), "readers": readers.get(f["name"], [])})
        covered = {c for s in segments for c in range(s["start"], s["end"] + 1)}
        problems += [f"{book}: chapter {c} has no recording" for c in range(1, chapters + 1) if c not in covered]
        books.append({"book": book, "chapters": chapters, "item": f"https://archive.org/details/{ident}", "segments": segments})
    if problems:
        print("\n".join(problems), file=sys.stderr)
        sys.exit(1)
    out = {
        "source": "LibriVox (public domain)",
        "translation": "KJV",
        "generated": date.today().isoformat(),
        "notes": "Each segment is one public-domain LibriVox MP3 on archive.org covering chapters start..end. Regenerate with scripts/bible-audio-map.py.",
        "books": books,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{sum(len(b['segments']) for b in books)} recordings for {len(books)} books -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()

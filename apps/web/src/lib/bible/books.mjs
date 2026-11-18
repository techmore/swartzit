// The 66 books of the Protestant canon, in order, with chapter counts and the
// USFM codes that Bible sites use in chapter URLs.
const OLD = [
  ['Genesis', 'GEN', 50], ['Exodus', 'EXO', 40], ['Leviticus', 'LEV', 27], ['Numbers', 'NUM', 36],
  ['Deuteronomy', 'DEU', 34], ['Joshua', 'JOS', 24], ['Judges', 'JDG', 21], ['Ruth', 'RUT', 4],
  ['1 Samuel', '1SA', 31], ['2 Samuel', '2SA', 24], ['1 Kings', '1KI', 22], ['2 Kings', '2KI', 25],
  ['1 Chronicles', '1CH', 29], ['2 Chronicles', '2CH', 36], ['Ezra', 'EZR', 10], ['Nehemiah', 'NEH', 13],
  ['Esther', 'EST', 10], ['Job', 'JOB', 42], ['Psalms', 'PSA', 150], ['Proverbs', 'PRO', 31],
  ['Ecclesiastes', 'ECC', 12], ['Song of Solomon', 'SNG', 8], ['Isaiah', 'ISA', 66], ['Jeremiah', 'JER', 52],
  ['Lamentations', 'LAM', 5], ['Ezekiel', 'EZK', 48], ['Daniel', 'DAN', 12], ['Hosea', 'HOS', 14],
  ['Joel', 'JOL', 3], ['Amos', 'AMO', 9], ['Obadiah', 'OBA', 1], ['Jonah', 'JON', 4], ['Micah', 'MIC', 7],
  ['Nahum', 'NAM', 3], ['Habakkuk', 'HAB', 3], ['Zephaniah', 'ZEP', 3], ['Haggai', 'HAG', 2],
  ['Zechariah', 'ZEC', 14], ['Malachi', 'MAL', 4]
];
const NEW = [
  ['Matthew', 'MAT', 28], ['Mark', 'MRK', 16], ['Luke', 'LUK', 24], ['John', 'JHN', 21], ['Acts', 'ACT', 28],
  ['Romans', 'ROM', 16], ['1 Corinthians', '1CO', 16], ['2 Corinthians', '2CO', 13], ['Galatians', 'GAL', 6],
  ['Ephesians', 'EPH', 6], ['Philippians', 'PHP', 4], ['Colossians', 'COL', 4], ['1 Thessalonians', '1TH', 5],
  ['2 Thessalonians', '2TH', 3], ['1 Timothy', '1TI', 6], ['2 Timothy', '2TI', 4], ['Titus', 'TIT', 3],
  ['Philemon', 'PHM', 1], ['Hebrews', 'HEB', 13], ['James', 'JAS', 5], ['1 Peter', '1PE', 5], ['2 Peter', '2PE', 3],
  ['1 John', '1JN', 5], ['2 John', '2JN', 1], ['3 John', '3JN', 1], ['Jude', 'JUD', 1], ['Revelation', 'REV', 22]
];

export const slugify = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const BOOKS = Object.freeze([
  ...OLD.map(([name, code, chapters]) => ({ name, code, chapters, testament: 'old' })),
  ...NEW.map(([name, code, chapters]) => ({ name, code, chapters, testament: 'new' }))
].map((book, index) => Object.freeze({ ...book, slug: slugify(book.name), order: index + 1 })));

const bySlug = new Map(BOOKS.map(book => [book.slug, book]));
const byName = new Map(BOOKS.map(book => [book.name.toLowerCase(), book]));

/** Find a book by slug ("1-samuel"), name ("1 Samuel"), or USFM code ("1SA"). */
export function findBook(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return null;
  return bySlug.get(key) || byName.get(key) || bySlug.get(slugify(key)) || BOOKS.find(book => book.code.toLowerCase() === key) || null;
}

/** "Psalm 23" for a single psalm, "Titus 1" otherwise. */
export function chapterLabel(book, chapter) {
  return `${book.name === 'Psalms' ? 'Psalm' : book.name} ${chapter}`;
}

export const chapterPath = (book, chapter) => `/bible/${book.slug}/${chapter}`;

/** A stable public URL for a chapter; used as the source identity of feed posts. */
export const chapterSourceUrl = (book, chapter) => `https://www.bible.com/bible/1/${book.code}.${chapter}.KJV`;

function flatten(books) {
  return books.flatMap(book => Array.from({ length: book.chapters }, (_, i) => ({ book, chapter: i + 1 })));
}

const OT_NARRATIVE = flatten(BOOKS.filter(book => book.testament === 'old' && book.name !== 'Psalms'));
const PSALMS = flatten([findBook('psalms')]);
const NT = flatten(BOOKS.filter(book => book.testament === 'new'));

export function dayOfYear(date) {
  const d = new Date(date);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((today - start) / 86_400_000) + 1;
}

/**
 * A one-year plan with three portions every day: the Old Testament (without
 * the Psalms) once through, one psalm (the Psalter about 2½ times a year), and
 * one New Testament chapter (the New Testament about 1½ times a year).
 */
export function dailyReading(date = new Date()) {
  const day = Math.min(dayOfYear(date), 365);
  const from = Math.floor(((day - 1) * OT_NARRATIVE.length) / 365);
  const to = Math.floor((day * OT_NARRATIVE.length) / 365);
  return {
    day,
    old: OT_NARRATIVE.slice(from, Math.max(to, from + 1)),
    psalm: [PSALMS[(day - 1) % PSALMS.length]],
    new: [NT[(day - 1) % NT.length]]
  };
}

/** Collapse consecutive chapters of the same book: "Ezekiel 12–13". */
export function describePassages(passages) {
  const groups = [];
  for (const { book, chapter } of passages) {
    const last = groups.at(-1);
    if (last && last.book === book && last.to === chapter - 1) last.to = chapter;
    else groups.push({ book, from: chapter, to: chapter });
  }
  return groups.map(({ book, from, to }) => from === to ? chapterLabel(book, from) : `${book.name} ${from}–${to}`).join('; ');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKS, findBook, chapterLabel, chapterSourceUrl, dailyReading, describePassages } from './books.mjs';

test('the canon has 66 books and 1,189 chapters', () => {
  assert.equal(BOOKS.length, 66);
  assert.equal(BOOKS.filter(book => book.testament === 'old').length, 39);
  assert.equal(BOOKS.reduce((sum, book) => sum + book.chapters, 0), 1189);
  assert.equal(new Set(BOOKS.map(book => book.slug)).size, 66);
});

test('books resolve by slug, name, or code', () => {
  assert.equal(findBook('titus').chapters, 3);
  assert.equal(findBook('1 Samuel').slug, '1-samuel');
  assert.equal(findBook('SNG').name, 'Song of Solomon');
  assert.equal(findBook('song-of-solomon').code, 'SNG');
  assert.equal(findBook('nope'), null);
  assert.equal(chapterLabel(findBook('psalms'), 23), 'Psalm 23');
  assert.equal(chapterSourceUrl(findBook('titus'), 2), 'https://www.bible.com/bible/1/TIT.2.KJV');
});

test('the daily plan covers the Old Testament exactly once and always has three portions', () => {
  const seen = [];
  for (let day = 0; day < 365; day++) {
    const reading = dailyReading(new Date(Date.UTC(2025, 0, 1 + day)));
    assert.equal(reading.day, day + 1);
    assert.ok(reading.old.length >= 1 && reading.old.length <= 3);
    assert.equal(reading.psalm.length, 1);
    assert.equal(reading.new.length, 1);
    seen.push(...reading.old.map(({ book, chapter }) => `${book.code}.${chapter}`));
  }
  assert.equal(seen.length, 779);
  assert.equal(new Set(seen).size, 779);
  assert.equal(seen[0], 'GEN.1');
  assert.equal(seen.at(-1), 'MAL.4');
});

test('leap day 366 reuses the final reading', () => {
  const last = dailyReading(new Date(Date.UTC(2024, 11, 31)));
  assert.equal(last.day, 365);
});

test('consecutive chapters are collapsed', () => {
  const ezekiel = findBook('ezekiel');
  assert.equal(describePassages([{ book: ezekiel, chapter: 12 }, { book: ezekiel, chapter: 13 }, { book: findBook('psalms'), chapter: 14 }]), 'Ezekiel 12–13; Psalm 14');
});

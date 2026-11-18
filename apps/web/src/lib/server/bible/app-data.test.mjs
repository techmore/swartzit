import test from 'node:test';
import assert from 'node:assert/strict';
import { library, reading, chapterPayload, findBook } from './app-data.mjs';

test('the app library lists every book, its recordings, and the catechism', () => {
  const lib = library();
  assert.equal(lib.books.length, 66);
  const titus = lib.books.find(b => b.slug === 'titus');
  assert.equal(titus.chapters, 3);
  assert.ok(titus.recordings.length >= 1 && titus.recordings[0].url.startsWith('https://'));
  assert.equal(lib.catechism.questions.length, 107);
  assert.doesNotThrow(() => JSON.stringify(lib));
});

test('a day of reading names its chapters and recordings', () => {
  const day = reading(new Date('2026-11-10T00:00:00Z'));
  assert.equal(day.date, '2026-11-10');
  assert.ok(day.passages.every(p => typeof p.book === 'string' && Number.isInteger(p.chapter)));
  assert.ok(day.tracks.length > 0);
});

test('chapter payloads link to their neighbours across books', () => {
  const last = chapterPayload(findBook('titus'), 3, { verses: [{ verse: 1, text: 'Put them in mind' }] });
  assert.deepEqual(last.next, { book: 'philemon', chapter: 1 });
  assert.deepEqual(last.previous, { book: 'titus', chapter: 2 });
  assert.equal(last.text_available, true);
  assert.equal(chapterPayload(findBook('genesis'), 1, null).previous, null);
  assert.equal(chapterPayload(findBook('revelation'), 22, null).next, null);
});

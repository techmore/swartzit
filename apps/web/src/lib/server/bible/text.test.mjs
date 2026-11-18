import test from 'node:test';
import assert from 'node:assert/strict';
import { findBook } from '#lib/bible/books.mjs';
import { parseChapter, chapterText } from './text.mjs';

const titus = findBook('titus');

test('chapter text keeps only verses of the requested chapter', () => {
  const parsed = parseChapter({ verses: [
    { chapter: 1, verse: 1, text: 'Paul, a servant of God,\n' },
    { chapter: 2, verse: 1, text: 'Wrong chapter' },
    { chapter: 1, verse: 2, text: '   ' }
  ] }, titus, 1);
  assert.deepEqual(parsed, { reference: 'Titus 1', translation: 'King James Version', verses: [{ verse: 1, text: 'Paul, a servant of God,' }] });
  assert.equal(parseChapter({}, titus, 1), null);
});

test('an unreachable text service yields null instead of an error', async () => {
  assert.equal(await chapterText(titus, 3, async () => { throw new Error('offline'); }), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKS, findBook } from './books.mjs';
import { audioCoverage, chapterTrack, bookTracks, passageTracks, segmentsFor } from './audio.mjs';

test('every chapter of all 66 books has a public-domain recording', () => {
  for (const entry of audioCoverage()) assert.equal(entry.withAudio, entry.chapters, entry.slug);
  for (const book of BOOKS) for (const s of segmentsFor(book)) assert.match(s.url, /^https:\/\/archive\.org\/download\/[^/]+\/[^/]+\.mp3$/);
});

test('Titus plays as one recording covering chapters 1–3', () => {
  const titus = findBook('titus');
  assert.equal(chapterTrack(titus, 2).title, 'Titus 1–3');
  assert.equal(chapterTrack(titus, 2).href, '/bible/titus/1');
  assert.equal(bookTracks(titus).length, 1);
});

test('a book plays from the recording containing the chapter', () => {
  const genesis = findBook('genesis');
  const from = bookTracks(genesis, 8);
  assert.equal(from[0].src, chapterTrack(genesis, 8).src);
  assert.equal(from.at(-1).src, chapterTrack(genesis, 50).src);
});

test('passages that share a recording are queued once', () => {
  const genesis = findBook('genesis');
  assert.equal(passageTracks([{ book: genesis, chapter: 1 }, { book: genesis, chapter: 2 }]).length, 1);
});

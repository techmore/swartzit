import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { queue, playTracks, enqueueTracks, step, clearQueue, tracksFromPost, hasAudio, savePosition, savedPosition, formatTime, normalizeTracks } from './audio-queue.mjs';

const titus = [1, 2, 3].map(n => ({ src: `https://archive.org/download/kjv/titus_${n}.mp3`, title: `Titus ${n}` }));

test('a book plays as one queue and stops after its last chapter', () => {
  playTracks(titus, 0);
  assert.equal(get(queue).tracks.length, 3);
  assert.equal(step(1), true);
  assert.equal(step(1), true);
  assert.equal(get(queue).tracks[get(queue).index].title, 'Titus 3');
  assert.equal(step(1), false);
  assert.equal(step(-1), true);
  clearQueue();
  assert.equal(get(queue).tracks.length, 0);
});

test('enqueue appends without duplicates and starts an empty queue', () => {
  clearQueue();
  enqueueTracks(titus.slice(0, 1));
  enqueueTracks(titus);
  assert.deepEqual(get(queue).tracks.map(track => track.title), ['Titus 1', 'Titus 2', 'Titus 3']);
  assert.equal(get(queue).index, 0);
});

test('unsafe or empty sources are dropped', () => {
  assert.deepEqual(normalizeTracks([{ src: 'javascript:alert(1)' }, { src: 'http://insecure/a.mp3' }, null]), []);
  assert.equal(normalizeTracks([{ src: '/media/4', href: 'https://evil.example' }])[0].href, '');
});

test('post audio becomes tracks named after each attachment', () => {
  const post = { title: 'Daily Reading', public_id: 'abc', source: { source_author: 'Swartzit Reading Plan', media: [
    { kind: 'audio', src: 'https://archive.org/a.mp3', alt: 'Genesis 1' },
    { kind: 'image', src: 'https://pbs.twimg.com/x.jpg' },
    { kind: 'audio', src: 'https://archive.org/b.mp3', alt: 'Psalm 1' }
  ] } };
  assert.equal(hasAudio(post), true);
  const tracks = tracksFromPost(post);
  assert.deepEqual(tracks.map(track => track.title), ['Genesis 1', 'Psalm 1']);
  assert.equal(tracks[0].href, '/post/abc');
  assert.equal(hasAudio({ source: { media: ['https://pbs.twimg.com/x.jpg'] } }), false);
});

test('only long recordings remember where they stopped', () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  savePosition('short', 100, 240, storage);
  assert.equal(savedPosition('short', storage), 0);
  savePosition('sermon', 1234.7, 2700, storage);
  assert.equal(savedPosition('sermon', storage), 1234);
  savePosition('sermon', 2690, 2700, storage);
  assert.equal(savedPosition('sermon', storage), 0);
});

test('times format as m:ss or h:mm:ss', () => {
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '0:00');
});

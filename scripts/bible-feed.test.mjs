import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, htmlToText, decodeEntities, sermonRecord, sharedLinksRemoved, chapterRecord, readingRecord, catechismRecord } from './bible-feed.mjs';
import { findBook } from '../apps/web/src/lib/bible/books.mjs';

const FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Example Presbyterian Church &amp; Sermons</title>
  <link>https://example.org</link>
  <itunes:image href="https://example.org/art.jpg"/>
  <item>
    <title><![CDATA[The Grace That Teaches (Titus 2:11–14)]]></title>
    <link>https://example.org/sermons/grace-that-teaches</link>
    <pubDate>Sun, 09 Nov 2026 15:00:00 GMT</pubDate>
    <itunes:author>Rev. John Knox</itunes:author>
    <description><![CDATA[<p>For the grace of God that bringeth salvation hath appeared to all men.</p><p>Second &rsquo;point&rsquo;</p>]]></description>
    <enclosure url="https://cdn.example.org/audio/2026-11-09.mp3?dl=1" length="40000000" type="audio/mpeg"/>
  </item>
  <item>
    <title>Bulletin</title>
    <enclosure url="https://example.org/bulletin.pdf" type="application/pdf"/>
  </item>
</channel>
</rss>`;

test('podcast feeds parse into audio items only', () => {
  const { channel, items } = parseFeed(FEED);
  assert.equal(channel.title, 'Example Presbyterian Church & Sermons');
  assert.equal(channel.image, 'https://example.org/art.jpg');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'The Grace That Teaches (Titus 2:11–14)');
  assert.equal(items[0].author, 'Rev. John Knox');
  assert.equal(items[0].published_at, '2026-11-09T15:00:00.000Z');
  assert.match(items[0].description, /bringeth salvation/);
  assert.match(items[0].description, /’point’/);
});

test('html and entities flatten to text', () => {
  assert.equal(htmlToText('<p>One</p><p>Two<br>Three</p>'), 'One\n\nTwo\nThree');
  assert.equal(decodeEntities('&#8220;Hi&#x201D; &amp; &unknown;'), '“Hi” & &unknown;');
});

test('sermons become audio posts with a stable source', () => {
  const { channel, items } = parseFeed(FEED);
  const record = sermonRecord({ name: 'Example PCA', community: 'sermons', image: channel.image }, items[0], new Date('2026-11-10T00:00:00Z'));
  assert.equal(record.community, 'sermons');
  assert.equal(record.provider, 'rss');
  assert.equal(record.source_url, 'https://example.org/sermons/grace-that-teaches');
  assert.deepEqual(record.media, [{ kind: 'audio', src: 'https://cdn.example.org/audio/2026-11-09.mp3?dl=1', alt: 'The Grace That Teaches (Titus 2:11–14)', poster: 'https://example.org/art.jpg' }]);
  assert.match(record.body, /^\*Rev\. John Knox\*/);
  assert.equal(sermonRecord({ name: 'x', community: 'sermons' }, { ...items[0], audio: 'https://example.org/page.html' }), null);
  assert.equal(sermonRecord({ name: 'x', community: 'sermons' }, { ...items[0], audio: 'https://example.org/master.wav' }), null);
});

test('chapters carry KJV text and LibriVox audio', () => {
  const titus = findBook('titus');
  const record = chapterRecord(titus, 1, { verses: [{ verse: 1, text: 'Paul, a servant of God,' }] });
  assert.equal(record.community, 'scripture');
  assert.equal(record.title, 'Titus 1');
  assert.equal(record.source_url, 'https://www.bible.com/bible/1/TIT.1.KJV');
  assert.equal(record.body, '**1** Paul, a servant of God,');
  assert.equal(record.media.length, 1);
  assert.equal(record.media[0].kind, 'audio');
  assert.equal(record.media[0].alt, 'Titus 1–3');
  assert.match(record.media[0].src, /^https:\/\/archive\.org\/download\/.+\.mp3$/);
});

test('daily reading links back to the instance and queues every chapter', () => {
  const record = readingRecord(new Date('2026-01-01T00:00:00Z'), 'https://example.org');
  assert.equal(record.source_url, 'https://example.org/bible/reading/2026-01-01');
  assert.match(record.title, /^Thursday, January 1 · Genesis 1–2; Psalm 1; Matthew 1$/);
  // Genesis 1–2 share one recording, so the queue has no repeats.
  assert.ok(record.media.length >= 3 && record.media.length <= 4);
  assert.equal(new Set(record.media.map(item => item.src)).size, record.media.length);
  assert.ok(record.media.every(item => item.kind === 'audio'));
});

test('catechism questions become deeper-dive posts', () => {
  const record = catechismRecord({ number: 1, question: 'What is the chief end of man?', answer: 'Man’s chief end is to glorify God, and to enjoy him for ever.', proofs: ['1 Cor. 10:31', 'Ps. 73:25–26'] }, 'https://example.org');
  assert.equal(record.community, 'deeper_dives');
  assert.equal(record.source_url, 'https://example.org/bible/catechism/1');
  assert.match(record.body, /glorify God/);
  assert.match(record.body, /1 Cor\. 10:31/);
});

test('the shipped sermon feed list is well formed', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('./bible/sermon-feeds.json', import.meta.url), 'utf8'));
  assert.ok(config.feeds.length >= 10);
  for (const feed of config.feeds) {
    assert.ok(['sermons', 'deeper_dives'].includes(feed.community), feed.name);
    assert.equal(new URL(feed.url).protocol, 'https:', feed.name);
    assert.ok(feed.name);
  }
});

test('episodes that share one web link are identified by their audio instead', () => {
  const items = sharedLinksRemoved([
    { title: 'Q 74', link: 'https://example.org/wsc/', audio: 'https://cdn.example.org/wsc74.mp3' },
    { title: 'Q 73', link: 'https://example.org/wsc/', audio: 'https://cdn.example.org/wsc73.mp3' },
    { title: 'Other', link: 'https://example.org/other', audio: 'https://cdn.example.org/o.mp3' }
  ]);
  const urls = items.map(item => sermonRecord({ name: 'Ligonier', community: 'deeper_dives' }, item).source_url);
  assert.deepEqual(urls, ['https://cdn.example.org/wsc74.mp3', 'https://cdn.example.org/wsc73.mp3', 'https://example.org/other']);
});

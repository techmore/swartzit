import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSourceUrl,hashBytes,normalizeRecord,selectRerunCandidates} from './content-harness.mjs';

test('canonicalizes X status URLs and removes tracking parameters',()=>{
  assert.equal(canonicalSourceUrl('x','https://twitter.com/alex/status/123?ref=foo'),'https://x.com/i/status/123');
});
test('records media hashes and normalizes media strings',()=>{
  const record=normalizeRecord({provider:'x',source_url:'https://x.com/a/status/9',media:['https://pbs.twimg.com/media/a.jpg']});
  assert.equal(record.media[0].kind,'image');
  assert.equal(hashBytes(Buffer.from('same'),'md5'),'51037a4a37730f52c8732586d3aaa316');
});
test('rerun selector excludes previously seen sources and media',()=>{
  const records=[
    {provider:'x',source_url:'https://x.com/a/status/1',media_hashes:['a']},
    {provider:'x',source_url:'https://x.com/a/status/2',media_hashes:['b']},
    {provider:'x',source_url:'https://x.com/a/status/3',media_hashes:['c']},
  ];
  const out=selectRerunCandidates(records,{usedSources:['https://x.com/i/status/1'],usedMediaHashes:['b'],limit:10,seed:'test'});
  assert.deepEqual(out.map(x=>x.source_url),['https://x.com/i/status/3']);
});
test('seeded selection is repeatable',()=>{
  const records=Array.from({length:8},(_,i)=>({provider:'x',source_url:`https://x.com/a/status/${i+1}`,media:[]}));
  assert.deepEqual(
    selectRerunCandidates(records,{limit:4,seed:'same'}).map(x=>x.source_url),
    selectRerunCandidates(records,{limit:4,seed:'same'}).map(x=>x.source_url),
  );
});

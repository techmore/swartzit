import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSourceUrl,fingerprintMedia,hashBytes,normalizeRecord,selectRerunCandidates} from './content-harness.mjs';

test('canonicalizes X status URLs and removes tracking parameters',()=>{
  assert.equal(canonicalSourceUrl('x','https://twitter.com/alex/status/123?ref=foo'),'https://x.com/i/status/123');
});
test('records media hashes and normalizes media strings',()=>{
  const record=normalizeRecord({provider:'x',source_url:'https://x.com/a/status/9',media:['https://pbs.twimg.com/media/a.jpg']});
  assert.equal(record.media[0].kind,'image');
  assert.equal(hashBytes(Buffer.from('same'),'md5'),'51037a4a37730f52c8732586d3aaa316');
});
test('fingerprints media with both hashes and an identifiable user agent',async()=>{
  const original=globalThis.fetch;let request;
  globalThis.fetch=async(url,options)=>{request={url,options};return new Response(Buffer.from('same'),{status:200,headers:{'content-type':'image/jpeg'}});};
  try {
    const out=await fingerprintMedia({provider:'x',source_url:'https://x.com/a/status/13',media:['https://pbs.twimg.com/media/a.jpg']},{fetchMedia:true});
    assert.equal(out.media[0].md5,'51037a4a37730f52c8732586d3aaa316');
    assert.equal(out.media[0].sha256,hashBytes(Buffer.from('same'),'sha256'));
    assert.match(request.options.headers['user-agent'],/public-media-fingerprint/);
  } finally {globalThis.fetch=original;}
});
test('fingerprinting retries throttled media and fails closed when retries run out',async()=>{
  const original=globalThis.fetch;
  let attempts=0;
  globalThis.fetch=async()=>++attempts===1
    ? new Response('rate limited',{status:429,headers:{'retry-after':'0'}})
    : new Response(Buffer.from('same'),{status:200,headers:{'content-type':'image/jpeg'}});
  try {
    const recovered=await fingerprintMedia({provider:'x',source_url:'https://x.com/a/status/14',media:['https://pbs.twimg.com/media/a.jpg']},{fetchMedia:true});
    assert.equal(attempts,2);
    assert.equal(recovered.media[0].md5,'51037a4a37730f52c8732586d3aaa316');
    attempts=0;
    globalThis.fetch=async()=>{attempts++;return new Response('rate limited',{status:429,headers:{'retry-after':'0'}});};
    await assert.rejects(
      fingerprintMedia({provider:'x',source_url:'https://x.com/a/status/14',media:['https://pbs.twimg.com/media/a.jpg']},{fetchMedia:true}),
      /Could not fingerprint media from pbs\.twimg\.com: HTTP 429/,
    );
    assert.equal(attempts,3);
  } finally {globalThis.fetch=original;}
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
test('batch selector keeps unique photos and removes exact duplicates by MD5 or SHA-256',()=>{
  const records=[
    {provider:'x',source_url:'https://x.com/a/status/10',media:[
      {kind:'image',src:'https://pbs.twimg.com/media/shared.jpg',md5:'a'.repeat(32),sha256:'1'.repeat(64)},
      {kind:'image',src:'https://pbs.twimg.com/media/first.jpg',md5:'b'.repeat(32),sha256:'2'.repeat(64)},
    ]},
    {provider:'x',source_url:'https://x.com/a/status/11',media:[
      {kind:'image',src:'https://pbs.twimg.com/media/repost.jpg',md5:'A'.repeat(32),sha256:'1'.repeat(64)},
      {kind:'image',src:'https://pbs.twimg.com/media/second.jpg',md5:'c'.repeat(32),sha256:'3'.repeat(64)},
    ]},
  ];
  const out=selectRerunCandidates(records,{limit:10,seed:'exact-photo-dedup'});
  const media=out.flatMap(record=>record.media);
  assert.equal(out.length,2);
  assert.equal(media.filter(item=>item.md5.toLowerCase()==='a'.repeat(32)).length,1);
  assert.ok(media.some(item=>item.md5==='b'.repeat(32)));
  assert.ok(media.some(item=>item.md5==='c'.repeat(32)));
  assert.equal(new Set(media.flatMap(item=>[item.md5,item.sha256])).size,media.length*2);
});
test('a multi-photo post keeps its new photos when one image was used before',()=>{
  const out=selectRerunCandidates([{
    provider:'x',source_url:'https://x.com/a/status/12',media:[
      {kind:'image',src:'https://pbs.twimg.com/media/old.jpg',md5:'d'.repeat(32),sha256:'4'.repeat(64)},
      {kind:'image',src:'https://pbs.twimg.com/media/new.jpg',md5:'e'.repeat(32),sha256:'5'.repeat(64)},
    ],
  }],{usedMediaHashes:['D'.repeat(32)],limit:10,seed:'partial-photo-dedup'});
  assert.equal(out.length,1);
  assert.deepEqual(out[0].media.map(item=>item.md5),['e'.repeat(32)]);
  assert.deepEqual(out[0].media_hashes,['5'.repeat(64),'e'.repeat(32)]);
});
test('seeded selection is repeatable',()=>{
  const records=Array.from({length:8},(_,i)=>({provider:'x',source_url:`https://x.com/a/status/${i+1}`,media:[]}));
  assert.deepEqual(
    selectRerunCandidates(records,{limit:4,seed:'same'}).map(x=>x.source_url),
    selectRerunCandidates(records,{limit:4,seed:'same'}).map(x=>x.source_url),
  );
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mediaFromTweet} from './x-media.mjs';
test('photos, highest-quality MP4, quoted media, and host validation',()=>{
  const video={type:'video',media_url_https:'https://pbs.twimg.com/poster.jpg',video_info:{variants:[{content_type:'video/mp4',bitrate:10,url:'https://video.twimg.com/low.mp4'},{content_type:'video/mp4',bitrate:20,url:'https://video.twimg.com/high.mp4'},{content_type:'video/mp4',bitrate:30,url:'https://evil.test/bad.mp4'}]}};
  const items=mediaFromTweet({mediaDetails:[{type:'photo',media_url_https:'https://pbs.twimg.com/photo.jpg'},video],quoted_tweet:{user:{screen_name:'quoted'},mediaDetails:[{type:'photo',media_url_https:'https://pbs.twimg.com/quote.jpg'}]}});
  assert.equal(items.length,3);assert.equal(items[1].src,'https://video.twimg.com/high.mp4');assert.equal(items[1].poster,'https://pbs.twimg.com/poster.jpg');assert.match(items[2].alt,/@quoted/);
  assert.deepEqual(mediaFromTweet({mediaDetails:[{type:'photo',media_url_https:'https://pbs.twimg.com.evil.test/bad.jpg'}]}),[]);
  assert.throws(()=>mediaFromTweet({mediaDetails:[{...video,video_info:{variants:[]}}]}),/no playable/);
});

test('public lookup preserves snapshot counts and rejects unavailable metadata',async()=>{
  const {enrichX}=await import('./x-media.mjs');
  const original=globalThis.fetch;
  const item={provider:'x',source_url:'https://x.com/example/status/123',source_views:42,observed_at:'2026-09-18T12:00:00Z',attribution:'Source includes a video; open the original to watch it.'};
  try {
    globalThis.fetch=async url=>{
      assert.equal(new URL(url).hostname,'cdn.syndication.twimg.com');
      return {ok:true,json:async()=>({id_str:'123',mediaDetails:[{type:'photo',media_url_https:'https://pbs.twimg.com/photo.jpg'}]})};
    };
    const result=await enrichX(item);
    assert.equal(result.media[0].kind,'image');
    assert.equal(result.source_views,42);
    assert.equal(result.observed_at,item.observed_at);
    assert.equal(result.attribution,'');
    globalThis.fetch=async()=>({ok:true,json:async()=>({})});
    await assert.rejects(enrichX(item),/metadata unavailable/);
    const observedMedia={...item,media:[{kind:'video',src:'https://video.twimg.com/observed.mp4',poster:'https://pbs.twimg.com/observed.jpg'}]};
    const fallback=await enrichX(observedMedia);
    assert.deepEqual(fallback.media,observedMedia.media);
    globalThis.fetch=async()=>({ok:false,status:429});
    await assert.rejects(enrichX(item),/HTTP 429/);
  } finally {globalThis.fetch=original;}
});

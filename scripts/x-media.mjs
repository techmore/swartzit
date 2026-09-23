// Resolve public X attachments without browser cookies or downloading media.
export function appendQuotedText(text, quotedText, quotedHandle) {
  const body=String(text??'').trim();
  const quote=String(quotedText??'').trim();
  const handle=String(quotedHandle??'').replace(/^@/,'').trim();
  if(!body||!quote||!handle||body.includes(`Quoted post by @${handle}:`))return body;
  return `${body}\n\nQuoted post by @${handle}: ${quote}`;
}
export function mediaFromTweet(tweet) {
  const result=[];
  const trusted=(url,host)=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password&&!u.port;}catch{return false;}};
  function collect(post,quoted=false) {
    const alt=quoted?`Quoted post by @${post.user?.screen_name??'unknown'}`:'';
    for(const m of post.mediaDetails??[]) {
      if(m.type==='photo' && trusted(m.media_url_https,'pbs.twimg.com'))result.push({kind:'image',src:m.media_url_https,alt:m.ext_alt_text||alt||undefined});
      if(['video','animated_gif'].includes(m.type)) {
        const variants=(m.video_info?.variants??[]).filter(v=>v.content_type==='video/mp4'&&trusted(v.url,'video.twimg.com')&&new URL(v.url).pathname.endsWith('.mp4')).sort((a,b)=>(b.bitrate??0)-(a.bitrate??0));
        if(!variants.length)throw Error('Public video has no playable MP4 variant');
        result.push({kind:'video',src:variants[0].url,poster:trusted(m.media_url_https,'pbs.twimg.com')?m.media_url_https:undefined,alt:alt||undefined});
      }
    }
  }
  collect(tweet);if(tweet.quoted_tweet)collect(tweet.quoted_tweet,true);
  return [...new Map(result.map(m=>[m.src,m])).values()].slice(0,8);
}
export async function enrichX(item) {
  if(item.provider!=='x')return item;
  const u=new URL(item.source_url);
  const id=u.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1];
  if(!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)||!id)throw Error('Invalid X status URL');
  const response=await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=0`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`X media metadata: HTTP ${response.status}`);
  const tweet=await response.json();
  // Authenticated collectors can supply a validated CDN attachment when X's
  // public syndication response is empty or omits the status. Keep that
  // observed media rather than degrading a video post into text-only content.
  if(tweet.id_str!==id){
    if(item.media?.length)return item;
    throw Error('X media metadata unavailable for '+id);
  }
  const media=mediaFromTweet(tweet);
  const profileImage=trustedProfileImage(tweet.user?.profile_image_url_https);
  const profile=profileFromUser(tweet.user);
  // Retain previously collected attachments if this response omitted them.
  if(!media.length && item.media?.length)return {...item, ...profile, profile_image_url:profileImage??item.profile_image_url};
  const attribution=(item.attribution??'').replace(/Source includes a video; open the original to watch it\.?/g,'').trim();
  const quoted=tweet.quoted_tweet;
  const quotedHandle=quoted?.user?.screen_name||quoted?.user?.username;
  const body=appendQuotedText(item.body,quoted?.text||quoted?.full_text,quotedHandle);
  return {...item,body,media, ...profile, profile_image_url:profileImage??item.profile_image_url,attribution};
}
function profileFromUser(user) {
  const handle=String(user?.screen_name??'').trim();
  if(!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return {};
  return {profile_url:`https://x.com/${handle}`, profile_display_name:user?.name||undefined, profile_verified:user?.is_blue_verified===true||user?.verified===true};
}
function trustedProfileImage(url) {
  try { const u=new URL(url); return u.protocol==='https:'&&u.hostname==='pbs.twimg.com'&&!u.username&&!u.password&&!u.port&&u.pathname.includes('/profile_images/') ? u.toString() : null; } catch { return null; }
}

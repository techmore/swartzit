import { appendQuotedText } from './x-media.mjs';
const now=()=>new Date().toISOString();
const titleOf=t=>t.split(/\r?\n/,1)[0].trim().slice(0,300)||'Imported post';
async function getJson(url,headers={}){const r=await fetch(url,{headers:{accept:'application/json',...headers},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);return r.json();}
const unescapeXml=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const tag=(xml,name)=>unescapeXml((xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,'i'))||[])[1]||'');
export async function collectRss(job){
  const r=await fetch(job.source,{headers:{accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'},signal:AbortSignal.timeout(20000)}); if(!r.ok)throw Error(`RSS feed: HTTP ${r.status}`);
  const xml=await r.text(); const blocks=[...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0,job.max_items); const captured=now();
  return blocks.map(([,kind,raw])=>{const title=tag(raw,'title'); const summary=tag(raw,kind.toLowerCase()==='entry'?'summary':'description')||tag(raw,'content'); const link=tag(raw,'link')||((raw.match(/<link[^>]+href=["']([^"']+)["']/i)||[])[1]||''); const id=tag(raw,'guid')||tag(raw,'id')||link; const published=tag(raw,'pubDate')||tag(raw,'published')||tag(raw,'updated'); if(!title||!link||!/^https:\/\//i.test(link))return null; return {community:job.community,provider:'rss',source_url:link,source_author:tag(raw,'author')||new URL(job.source).hostname,title:title.slice(0,300),body:summary||title,published_at:Number.isNaN(Date.parse(published))?null:new Date(published).toISOString(),observed_at:captured,source_views:null,source_likes:null,source_reposts:null,source_replies:null,media:[],attribution:`Imported from ${job.source}; source item: ${id}`};}).filter(Boolean);
}
export async function collectReddit(job){
  const source=job.source.trim();
  const match=source.match(/(?:reddit\.com\/r\/|^r\/)([A-Za-z0-9_+-]+)/i);
  const search=source.match(/^search:\s*(.+)$/i)?.[1];
  if(!match&&!search)throw Error('Reddit source must be r/name, a subreddit URL, or search: query');
  const endpoint=match
    ? `https://www.reddit.com/r/${match[1]}/new.json?limit=${Math.min(job.max_items,100)}`
    : `https://www.reddit.com/search.json?${new URLSearchParams({q:search,sort:'new',t:'month',limit:String(Math.min(job.max_items,100))})}`;
  const data=await getJson(endpoint,{'user-agent':'Swartzit/0.1 (self-hosted public importer)'});
  const captured=now(); return data.data.children.map(({data:d})=>{if(!d?.id||d.author==='[deleted]'||!d.permalink)return null; const body=d.selftext||d.url||''; return {community:job.community,provider:'reddit',source_url:`https://www.reddit.com${d.permalink}`,source_author:d.author?`u/${d.author}`:'[deleted]',title:d.title||titleOf(body),body,published_at:d.created_utc?new Date(d.created_utc*1000).toISOString():null,observed_at:captured,source_views:null,source_likes:Number.isSafeInteger(d.score)?d.score:null,source_reposts:null,source_replies:Number.isSafeInteger(d.num_comments)?d.num_comments:null,media:[],attribution:`Imported from r/${d.subreddit}; source: https://www.reddit.com${d.permalink}`};}).filter(Boolean);
}

function xTime(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Error(`X ${label} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

export function applyXWindow(params, job) {
  const start = job.start_time ?? job.startTime;
  const end = job.end_time ?? job.endTime;
  const normalizedStart = start == null || start === '' ? null : xTime(start, 'start_time');
  const normalizedEnd = end == null || end === '' ? null : xTime(end, 'end_time');
  if (normalizedStart && normalizedEnd && Date.parse(normalizedStart) >= Date.parse(normalizedEnd)) {
    throw Error('X start_time must be earlier than end_time');
  }
  if (normalizedStart) params.set('start_time', normalizedStart);
  if (normalizedEnd) params.set('end_time', normalizedEnd);
  const exclude = Array.isArray(job.exclude) ? job.exclude.filter(Boolean).join(',') : String(job.exclude || '');
  if (exclude) params.set('exclude', exclude);
  return {start_time: normalizedStart, end_time: normalizedEnd};
}

export async function collectX(job) {
  const token=process.env.X_BEARER_TOKEN;
  if (!token) throw Error('X_BEARER_TOKEN is not configured');
  const h={authorization:`Bearer ${token}`};
  const fields='created_at,public_metrics,attachments,text,author_id,referenced_tweets';
  const mediaFields='type,url,preview_image_url,alt_text,variants,media_key';
  const captured=now();
  const query=job.source.trim().replace(/^search:\s*/i,'');
  let tweets, users, media;
  if (/^search:/i.test(job.source)) {
    if (!query || query.length > 512) throw Error('X search source must contain a query of at most 512 characters');
    const params=new URLSearchParams({query, max_results:String(Math.max(10,Math.min(job.max_items,100))), 'tweet.fields':fields, expansions:'author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id', 'user.fields':'protected,profile_image_url,name,username,description,public_metrics,verified', 'media.fields':mediaFields});
    applyXWindow(params, job);
    const d=await getJson(`https://api.x.com/2/tweets/search/recent?${params}`,h);
    tweets=d.data||[]; users=d.includes?.users||[]; media=d.includes?.media||[];
    var quotedTweets=d.includes?.tweets||[];
  } else {
    const handle=job.source.replace(/^@/,'').replace(/^https?:\/\/(?:www\.)?x\.com\//,'').split(/[/?#]/)[0];
    if (!handle) throw Error('X source must be an @handle, X profile URL, or search: query');
    const u=await getJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=protected,profile_image_url,name,username,description,public_metrics,verified`,h);
    if (u.data?.protected) throw Error('The X source is protected');
    users=[u.data];
    const params=new URLSearchParams({max_results:String(Math.max(10,Math.min(job.max_items,100))), 'tweet.fields':fields, expansions:'attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id', 'user.fields':'protected,profile_image_url,name,username,description,public_metrics,verified', 'media.fields':mediaFields});
    applyXWindow(params, job);
    const d=await getJson(`https://api.x.com/2/users/${u.data.id}/tweets?${params}`,h);
    tweets=d.data||[]; users=[...users,...(d.includes?.users||[])]; media=d.includes?.media||[];
    var quotedTweets=d.includes?.tweets||[];
  }
  const byMedia=new Map(media.map(m=>[m.media_key,m]));
  const byUser=new Map(users.filter(Boolean).map(u=>[u.id,u]));
  return tweets.slice(0,job.max_items).map(t=>{
    const profile=byUser.get(t.author_id)||{};
    if (profile.protected) return null;
    const username=profile.username||'unknown';
    const attachments=(t.attachments?.media_keys||[]).map(k=>byMedia.get(k)).filter(Boolean).map(x=>{
      if (x.type==='photo'&&x.url) return {kind:'image',src:x.url,alt:x.alt_text||null};
      if (x.type==='video'||x.type==='animated_gif') { const v=(x.variants||[]).filter(y=>y.content_type==='video/mp4'&&y.url).sort((a,b)=>(b.bit_rate||0)-(a.bit_rate||0))[0]; if(v) return {kind:'video',src:v.url,poster:x.preview_image_url||null,alt:x.alt_text||null}; }
      return null;
    }).filter(Boolean);
    const metrics=t.public_metrics||{}, profileMetrics=profile.public_metrics||{};
    const quoteId=t.referenced_tweets?.find(ref=>ref.type==='quoted')?.id;
    const quoted=quotedTweets.find(item=>item.id===quoteId);
    const quotedProfile=byUser.get(quoted?.author_id)||{};
    const body=appendQuotedText(t.text||'',quoted?.text,quotedProfile.username);
    return {community:job.community,provider:'x',source_url:`https://x.com/${username}/status/${t.id}`,source_author:`@${username}`,title:titleOf(t.text||''),body,published_at:t.created_at||null,observed_at:captured,source_views:Number.isSafeInteger(metrics.impression_count)?metrics.impression_count:null,source_likes:Number.isSafeInteger(metrics.like_count)?metrics.like_count:null,source_reposts:Number.isSafeInteger(metrics.retweet_count)?metrics.retweet_count:null,source_replies:Number.isSafeInteger(metrics.reply_count)?metrics.reply_count:null,media:attachments,profile_image_url:profile.profile_image_url||null,profile_url:`https://x.com/${username}`,profile_display_name:profile.name||null,profile_bio:profile.description||null,profile_followers:Number.isSafeInteger(profileMetrics.followers_count)?profileMetrics.followers_count:null,profile_following:Number.isSafeInteger(profileMetrics.following_count)?profileMetrics.following_count:null,profile_verified:profile.verified===true,attribution:`Imported from @${username}; source: https://x.com/${username}/status/${t.id}`};
  }).filter(Boolean);
}

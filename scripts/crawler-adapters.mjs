import { join } from 'node:path';
import { appendXContext, parseXStatusUrl, resolveXPost, xPostText } from '../apps/web/src/lib/x-source.mjs';

import { launchPlaywrightContext } from './x-playwright-recommended-runner.mjs';
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

export function normalizeXBearerToken(value) {
  if (typeof value !== 'string' || !value) throw Error('X_BEARER_TOKEN is not configured');
  try {
    return decodeURIComponent(value);
  } catch {
    throw Error('X_BEARER_TOKEN contains invalid percent encoding');
  }
}

export function xBrowserPlan(job, now = Date.now()) {
  const source = String(job.source || '').trim();
  const search = /^search:/i.test(source);
  const handle = search ? null : source.replace(/^@/, '').replace(/^https?:\/\/(?:www\.)?x\.com\//i, '').split(/[/?#]/)[0];
  if (!search && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw Error('X browser source must be an account handle, profile URL, or search: query');
  const start = job.start_time ?? job.startTime;
  const end = job.end_time ?? job.endTime;
  const startMs = start ? Date.parse(start) : Number(now) - Number(job.hours || 24) * 3600000;
  const endMs = end ? Date.parse(end) : Number(now);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) throw Error('X browser source window is invalid');
  const limit = Number(job.max_items ?? 15);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('X browser max_items must be an integer from 1 to 100');
  const exclusions = [...new Set((Array.isArray(job.exclude) ? job.exclude : String(job.exclude || '').split(',')).map(value => String(value).trim().toLowerCase()).filter(Boolean))];
  let url = 'https://x.com/' + handle;
  if (search) {
    const query = source.replace(/^search:\s*/i, '').trim();
    if (!query || query.length > 512) throw Error('X search source must contain a query of at most 512 characters');
    // Translate API operators outside quoted phrases to the public search UI.
    const translated = query.split(/("(?:\\.|[^"\\])*")/).map((part, index) => index % 2 ? part : part
      .replace(/(^|[\s(])(-?)is:retweet(?=[\s)]|$)/g, '$1$2filter:retweets')
      .replace(/(^|[\s(])(-?)is:reply(?=[\s)]|$)/g, '$1$2filter:replies')
      .replace(/(^|[\s(])(-?)has:(media|images|videos)(?=[\s)]|$)/g, '$1$2filter:$3')).join('');
    const since = new Date(startMs).toISOString().slice(0, 10);
    const until = new Date(Math.ceil(endMs / 86400000) * 86400000).toISOString().slice(0, 10);
    const filters = exclusions.map(value => value === 'replies' ? '-filter:replies' : value === 'retweets' ? '-filter:retweets' : '').filter(Boolean);
    url = 'https://x.com/search?' + new URLSearchParams({q: [translated, ...filters, 'since:' + since, 'until:' + until].join(' '), src: 'typed_query', f: 'live'});
  }
  return {url, search, handle, startMs, endMs, limit, exclusions};
}

export async function collectXFromPlaywright(job, {launch = launchPlaywrightContext, resolve = resolveXPost, now = Date.now()} = {}) {
  const plan = xBrowserPlan(job, now);
  const profileDir = process.env.X_PLAYWRIGHT_USER_DATA_DIR || join(process.env.SWARTZIT_WORKER_STATE_DIR || process.cwd(), 'x-playwright-profile');
  const context = await launch({userDataDir: profileDir});
  try {
    const page = await context.newPage();
    await page.goto(plan.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await page.waitForSelector('article[data-testid="tweet"]', { state: 'visible', timeout: 20000 });
    } catch {
      const body = await page.locator('body').innerText().catch(() => '');
      if (/no results for|try searching for something else|hasn[’']t posted/i.test(body)) return [];
      if (/sign\s*in|log\s*in/i.test(body)) throw Error('The dedicated X Playwright profile is not signed in');
      throw Error(plan.search ? 'X did not load the Latest search results' : `X did not load the public profile @${plan.handle}`);
    }
    const {startMs, endMs, limit} = plan;
    const exclusions = new Set(plan.exclusions);
    const candidates = new Map();
    let reachedStart = false;
    for (let scroll = 0; scroll < 14 && candidates.size < limit && !reachedStart; scroll += 1) {
      const rows = await page.evaluate(() => [...document.querySelectorAll('article[data-testid="tweet"]')].map(article => {
        const time = article.querySelector('time[datetime]');
        const href = time?.closest('a')?.href || '';
        const context = article.querySelector('[data-testid="socialContext"]')?.innerText || '';
        const textNode = article.querySelector('[data-testid="tweetText"]');
        const beforeText = textNode ? (article.innerText || '').split(textNode.innerText || '')[0] : article.innerText || '';
        const status = href.match(/\/status\/(\d+)/);
        return { id: status?.[1] || null, href, published_at: time?.getAttribute('datetime') || null, pinned: /\bpinned\b/i.test(context), reposted: /\breposted\b/i.test(context), replying: /\breplying to\b/i.test(beforeText) };
      }));
      for (const row of rows) {
        const timestamp = Date.parse(row.published_at || '');
        if (!row.id || !Number.isFinite(timestamp) || row.pinned) continue;
        if (timestamp < startMs) { if (!plan.search) reachedStart = true; continue; }
        if (timestamp > endMs || (exclusions.has('replies') && row.replying) || (exclusions.has('retweets') && row.reposted)) continue;
        try { candidates.set(row.id, parseXStatusUrl(row.href).source_url); } catch { /* Only canonical public status links are eligible. */ }
      }
      if (candidates.size >= limit || reachedStart || scroll === 13) break;
      await page.evaluate(() => window.scrollBy(0, Math.max(650, Math.floor(window.innerHeight * 0.8))));
      await page.waitForTimeout(650);
    }
    const posts = [];
    const ordered = [...candidates.values()].slice(0, limit);
    for (const sourceUrl of ordered) {
      const post = await resolve(sourceUrl);
      const timestamp = Date.parse(post.published_at || '');
      if (!Number.isFinite(timestamp) || timestamp < startMs || timestamp > endMs) continue;
      posts.push({
        ...post,
        community: job.community,
        attribution: `Imported from ${post.source_author}; source: ${post.source_url}`
      });
    }
    return posts;
  } finally {
    await context.close();
  }
}

export async function collectX(job) {
  if (process.env.X_SOURCE_MODE === 'playwright') return collectXFromPlaywright(job);
  const token=normalizeXBearerToken(process.env.X_BEARER_TOKEN);
  const h={authorization:`Bearer ${token}`};
  const fields='created_at,public_metrics,attachments,text,note_tweet,author_id,referenced_tweets';
  const mediaFields='type,url,preview_image_url,alt_text,variants,media_key';
  const captured=now();
  const query=job.source.trim().replace(/^search:\s*/i,'');
  let tweets, users, media, relatedTweets;
  try {
  if (/^search:/i.test(job.source)) {
    if (!query || query.length > 512) throw Error('X search source must contain a query of at most 512 characters');
    const params=new URLSearchParams({query, max_results:String(Math.max(10,Math.min(job.max_items,100))), 'tweet.fields':fields, expansions:'author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id', 'user.fields':'protected,profile_image_url,name,username,description,public_metrics,verified', 'media.fields':mediaFields});
    applyXWindow(params, {...job, exclude: []});
    const excluded = new Set(Array.isArray(job.exclude) ? job.exclude : String(job.exclude || '').split(','));
    const filters = [excluded.has('replies') ? '-is:reply' : '', excluded.has('retweets') ? '-is:retweet' : ''].filter(Boolean);
    const searchQuery = [query, ...filters].join(' ');
    if (searchQuery.length > 512) throw Error('X search query including exclusions must be at most 512 characters');
    params.set('query', searchQuery);
    const d=await getJson(`https://api.x.com/2/tweets/search/recent?${params}`,h);
    tweets=d.data||[]; users=d.includes?.users||[]; media=d.includes?.media||[];
    relatedTweets=d.includes?.tweets||[];
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
    relatedTweets=d.includes?.tweets||[];
  }
  const byMedia=new Map(media.map(m=>[m.media_key,m]));
  const relatedById=new Map(relatedTweets.map(item=>[item.id,item]));
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
    const refs=t.referenced_tweets||[];
    const quote=relatedById.get(refs.find(ref=>ref.type==='quoted')?.id);
    const parent=relatedById.get(refs.find(ref=>ref.type==='replied_to')?.id);
    const relatedAuthor=item=>byUser.get(item?.author_id)?.username;
    let body=xPostText(t);
    if(parent)body=appendXContext(body,'Thread context',relatedAuthor(parent),xPostText(parent));
    if(quote)body=appendXContext(body,'Quoted post',relatedAuthor(quote),xPostText(quote));
    const sourceText=xPostText(t);
    return {community:job.community,provider:'x',source_url:`https://x.com/${username}/status/${t.id}`,source_author:`@${username}`,title:titleOf(sourceText),body,published_at:t.created_at||null,observed_at:captured,source_views:Number.isSafeInteger(metrics.impression_count)?metrics.impression_count:null,source_likes:Number.isSafeInteger(metrics.like_count)?metrics.like_count:null,source_reposts:Number.isSafeInteger(metrics.retweet_count)?metrics.retweet_count:null,source_replies:Number.isSafeInteger(metrics.reply_count)?metrics.reply_count:null,media:attachments,profile_image_url:profile.profile_image_url||null,profile_url:`https://x.com/${username}`,profile_display_name:profile.name||null,profile_bio:profile.description||null,profile_followers:Number.isSafeInteger(profileMetrics.followers_count)?profileMetrics.followers_count:null,profile_following:Number.isSafeInteger(profileMetrics.following_count)?profileMetrics.following_count:null,profile_verified:profile.verified===true,attribution:`Imported from @${username}; source: https://x.com/${username}/status/${t.id}`};
  }).filter(Boolean);
  } catch (error) {
    if (/HTTP 402\b/.test(error.message) && process.env.X_PLAYWRIGHT_USER_DATA_DIR) return collectXFromPlaywright(job);
    throw error;
  }
}

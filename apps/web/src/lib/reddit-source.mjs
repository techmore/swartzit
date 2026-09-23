const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'redd.it']);
const MEDIA_HOSTS = new Set(['i.redd.it', 'preview.redd.it', 'v.redd.it']);

function validId(value) {
  return /^[A-Za-z0-9]{1,16}$/.test(value || '');
}

function validSlug(value) {
  return /^[A-Za-z0-9_-]{1,200}$/.test(value || '');
}

function cleanMediaUrl(raw) {
  if (typeof raw !== 'string') return null;
  const decoded = raw.replaceAll('&amp;', '&').trim();
  try {
    const url = new URL(decoded);
    return url.protocol === 'https:' && MEDIA_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function count(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function parseRedditPostUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Paste a public Reddit post link.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('That does not look like a valid link.'); }
  if (url.protocol !== 'https:' || !REDDIT_HOSTS.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Use a public post link from reddit.com.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  let id = '';
  let subreddit = '';
  let slug = '';
  if (url.hostname === 'redd.it') {
    if (parts.length !== 1 || !validId(parts[0])) throw new Error('Use a link to one Reddit post, not a subreddit or feed.');
    id = parts[0];
  } else {
    const commentsIndex = parts.indexOf('comments');
    if (commentsIndex === 2 && parts[0].toLowerCase() === 'r' && parts[1] && validId(parts[3])) {
      subreddit = parts[1];
      id = parts[3];
      slug = validSlug(parts[4]) ? parts[4] : '';
    } else if (commentsIndex === 0 && validId(parts[1])) {
      id = parts[1];
      slug = validSlug(parts[2]) ? parts[2] : '';
    } else {
      throw new Error('Use a link to one Reddit post, not a subreddit or feed.');
    }
  }
  const path = subreddit
    ? `/r/${subreddit}/comments/${id}${slug ? `/${slug}` : ''}`
    : `/comments/${id}${slug ? `/${slug}` : ''}`;
  const apiPath = slug ? path.split('/').slice(0, -1).join('/') : path;
  return {
    id,
    source_url: `https://www.reddit.com${path}`,
    api_url: `https://www.reddit.com${apiPath}.json?raw_json=1&limit=50`
  };
}

function mediaFromPost(post) {
  const result = [];
  const title = String(post.title ?? '').trim().slice(0, 1000);
  const preview = cleanMediaUrl(post.preview?.images?.[0]?.source?.url);
  const add = (kind, raw, alt = title, extra = {}) => {
    const src = cleanMediaUrl(raw);
    if (!src || result.some(item => item.src === src)) return;
    result.push({ kind, src, ...(alt ? { alt } : {}), ...extra });
  };

  for (const item of post.gallery_data?.items ?? []) {
    const metadata = post.media_metadata?.[item.media_id];
    const source = metadata?.s?.u || metadata?.p?.at?.(-1)?.u;
    add('image', source, metadata?.a || title);
  }

  const video = post.media?.reddit_video?.fallback_url;
  if (video && cleanMediaUrl(video) && new URL(cleanMediaUrl(video)).pathname.endsWith('.mp4')) {
    add('video', video, title, preview ? { poster: preview } : {});
  }

  const destination = post.url_overridden_by_dest || post.url;
  const destinationUrl = cleanMediaUrl(destination);
  if (destinationUrl?.includes('v.redd.it/') && new URL(destinationUrl).pathname.endsWith('.mp4')) add('video', destinationUrl, title, preview ? { poster: preview } : {});
  else if (destinationUrl) add('image', destinationUrl, title);

  if (!result.length && preview) add('image', preview, title);
  return result.slice(0, 8);
}

function sourceComments(listing) {
  return (listing?.data?.children ?? [])
    .filter(item => item?.kind === 't1' && item.data?.body)
    .slice(0, 20)
    .map(item => ({
      author: item.data.author ? `u/${String(item.data.author).slice(0, 32)}` : '[deleted]',
      body: String(item.data.body).trim().slice(0, 5000),
      score: count(item.data.score),
      created_at: item.data.created_utc ? new Date(item.data.created_utc * 1000).toISOString() : null
    }))
    .filter(item => item.body);
}

export async function resolveRedditPost(raw, fetcher = fetch) {
  const { id, source_url, api_url } = parseRedditPostUrl(raw);
  const response = await fetcher(api_url, {
    headers: { accept: 'application/json', 'user-agent': 'Swartzit cross-post importer/1.0' },
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Reddit could not load that post. Check that it is public and try again.');
  const payload = await response.json();
  const post = payload?.[0]?.data?.children?.find(item => item?.kind === 't3')?.data;
  if (!post || String(post.id ?? '') !== id) throw new Error('That Reddit post is unavailable or private.');
  const subreddit = String(post.subreddit ?? '').trim();
  const author = post.author ? `u/${String(post.author).slice(0, 32)}` : '[deleted]';
  const published = Number(post.created_utc) * 1000;
  return {
    provider: 'reddit',
    source_url,
    source_author: author,
    title: String(post.title ?? '').trim().slice(0, 300) || 'Reddit post',
    body: String(post.selftext ?? '').trim().slice(0, 50000),
    published_at: Number.isFinite(published) && published > 0 ? new Date(published).toISOString() : null,
    observed_at: new Date().toISOString(),
    source_views: null,
    source_likes: count(post.score),
    source_reposts: null,
    source_replies: count(post.num_comments),
    media: mediaFromPost(post),
    source_comments: sourceComments(payload?.[1]),
    attribution: `Imported from ${subreddit ? `r/${subreddit}` : 'Reddit'}; source: ${source_url}`,
    profile_image_url: null,
    profile_url: null,
    profile_display_name: null,
    profile_bio: null,
    profile_followers: null,
    profile_following: null,
    profile_verified: null
  };
}

const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
const MAX_CONTEXT_DEPTH = 8;
const MAX_BODY_BYTES = 250_000;

export function parseXStatusUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Paste a public X post link.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('That does not look like a valid link.'); }
  if (url.protocol !== 'https:' || !X_HOSTS.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Use a public post link from x.com or twitter.com.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const statusPath = parts.length >= 3 && parts[1] === 'status';
  const validMediaSuffix = parts.length === 3
    || parts.length === 5 && ['video', 'photo'].includes(parts[3]) && /^\d+$/.test(parts[4]);
  const id = statusPath && validMediaSuffix && /^\d{1,24}$/.test(parts[2]) ? parts[2] : null;
  if (!id) throw new Error('Use a link to one X post, not a profile or feed.');
  return { id, source_url: `https://x.com/i/status/${id}` };
}

function trustedUrl(raw, host) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port
      ? url.toString()
      : null;
  } catch { return null; }
}

function statusId(tweet) {
  const id = tweet?.id_str ?? tweet?.id ?? tweet?.rest_id;
  return id == null ? '' : String(id);
}

function postText(tweet) {
  const note = tweet?.note_tweet_results?.result?.text
    ?? tweet?.note_tweet?.note_tweet_results?.result?.text
    ?? tweet?.note_tweet?.text;
  const rawText = typeof tweet?.raw_text === 'string' ? tweet.raw_text : tweet?.raw_text?.text;
  for (const candidate of [note, tweet?.full_text, rawText, tweet?.text]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

export function xPostText(tweet) {
  return postText(tweet);
}

function hasUnexpandedNote(tweet) {
  const hasNote = Boolean(tweet?.note_tweet || tweet?.note_tweet_results || tweet?.is_note_tweet);
  const noteText = tweet?.note_tweet_results?.result?.text
    ?? tweet?.note_tweet?.note_tweet_results?.result?.text
    ?? tweet?.note_tweet?.text;
  return hasNote && !(typeof noteText === 'string' && noteText.trim());
}

function relatedPost(tweet, kind) {
  const candidates = kind === 'parent'
    ? [tweet?.parent, tweet?.in_reply_to_status, tweet?.replying_to_status]
    : [tweet?.quoted_tweet, tweet?.quoted_status, tweet?.qrt, tweet?.quote];
  for (let value of candidates) {
    if (value && typeof value === 'object') {
      value = value.result?.tweet ?? value.result ?? value.tweet ?? value;
      if (value && typeof value === 'object' && !value.__typename?.includes('Tombstone')) return value;
    }
  }
  return null;
}

function parentId(tweet) {
  const parent = relatedPost(tweet, 'parent');
  const value = tweet?.in_reply_to_status_id_str
    ?? tweet?.in_reply_to_status_id
    ?? (typeof tweet?.replying_to_status === 'string' || typeof tweet?.replying_to_status === 'number' ? tweet.replying_to_status : null)
    ?? statusId(parent);
  return value == null ? '' : String(value);
}

function handleOf(tweet) {
  return String(tweet?.user?.screen_name ?? tweet?.user?.username ?? tweet?.author?.screen_name ?? '').replace(/^@/, '');
}

function mediaFromTweet(tweet, ancestors = []) {
  const result = [];
  const posts = [tweet, ...ancestors];
  const seen = new Set();
  for (const root of [tweet, ...ancestors]) {
    let quote = relatedPost(root, 'quote');
    for (let depth = 0; quote && depth < 4; depth += 1) {
      const id = statusId(quote) || `${handleOf(quote)}:${postText(quote)}`;
      if (seen.has(id)) break;
      seen.add(id);
      posts.push(quote);
      quote = relatedPost(quote, 'quote');
    }
  }
  for (const post of posts) {
    const quotedHandle = post === tweet ? '' : handleOf(post) || 'unknown';
    for (const item of post.mediaDetails ?? []) {
      const alt = item.ext_alt_text || item.alt_text || (quotedHandle ? `Media from @${quotedHandle}` : undefined);
      const image = trustedUrl(item.media_url_https, 'pbs.twimg.com');
      if (item.type === 'photo' && image) {
        result.push({ kind: 'image', src: image, ...(alt ? { alt } : {}) });
      } else if (['video', 'animated_gif'].includes(item.type)) {
        const variants = (item.video_info?.variants ?? [])
          .filter(variant => variant.content_type === 'video/mp4' && trustedUrl(variant.url, 'video.twimg.com') && new URL(variant.url).pathname.endsWith('.mp4'))
          .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
        if (variants.length) {
          result.push({ kind: 'video', src: trustedUrl(variants[0].url, 'video.twimg.com'), ...(image ? { poster: image } : {}), ...(alt ? { alt } : {}) });
        }
      }
    }
  }
  return [...new Map(result.map(item => [item.src, item])).values()].slice(0, 8);
}

function count(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function originalPost(tweet) {
  const result = tweet.retweeted_status ?? tweet.retweeted_status_result?.result?.tweet ?? tweet.retweeted_status_result?.result;
  return result && typeof result === 'object' ? result : tweet;
}

export function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function fromFxStatus(status, quoteDepth = 0) {
  if (!status || typeof status !== 'object') return null;
  const user = status.author ?? {};
  const media = status.media ?? {};
  const mediaDetails = [];

  for (const photo of media.photos ?? []) {
    mediaDetails.push({
      type: photo.type === 'gif' ? 'animated_gif' : 'photo',
      media_url_https: photo.url,
      ext_alt_text: photo.altText
    });
  }
  for (const video of media.videos ?? []) {
    mediaDetails.push({
      type: video.type === 'gif' ? 'animated_gif' : 'video',
      media_url_https: video.thumbnail_url,
      video_info: {
        variants: (video.formats ?? []).map(format => ({
          content_type: format.container === 'mp4' ? 'video/mp4' : `video/${format.container ?? ''}`,
          bitrate: format.bitrate,
          url: format.url
        }))
      }
    });
  }

  const quoteValue = status.qrt ?? status.quote ?? status.quoted_tweet;
  const quote = quoteDepth < 4 && quoteValue?.type !== 'media'
    ? fromFxStatus(quoteValue, quoteDepth + 1)
    : null;
  const parentValue = status.parent ?? (status.replying_to_status && typeof status.replying_to_status === 'object' ? status.replying_to_status : null);
  const parent = parentValue && quoteDepth < MAX_CONTEXT_DEPTH ? fromFxStatus(parentValue, quoteDepth + 1) : null;
  const rawText = typeof status.raw_text === 'string' ? status.raw_text : status.raw_text?.text;
  return {
    id_str: String(status.id ?? ''),
    text: typeof status.text === 'string' ? status.text : (rawText ?? ''),
    full_text: rawText || undefined,
    created_at: status.created_at,
    favorite_count: status.likes,
    retweet_count: status.reposts,
    reply_count: status.replies,
    views: status.views == null ? null : { count: status.views },
    user: {
      screen_name: user.screen_name,
      name: user.name,
      description: user.description,
      profile_image_url_https: user.avatar_url,
      followers_count: user.followers,
      friends_count: user.following,
      is_blue_verified: user.verification?.verified === true,
      verified: user.verification?.verified === true
    },
    mediaDetails,
    ...(quote ? { quoted_tweet: quote } : {}),
    ...(parent ? { parent } : {}),
    ...(status.replying_to_status && typeof status.replying_to_status !== 'object' ? { in_reply_to_status_id_str: String(status.replying_to_status) } : {})
  };
}

async function fetchSyndication(id, fetcher) {
  if (!/^\d{1,24}$/.test(String(id))) return null;
  const url = new URL('https://cdn.syndication.twimg.com/tweet-result');
  url.searchParams.set('id', String(id));
  url.searchParams.set('lang', 'en');
  url.searchParams.set('token', syndicationToken(String(id)));
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const result = await response.json();
    return isMatchingTweet(result, String(id)) ? result : null;
  } catch {
    return null;
  }
}

async function fetchFxStatus(id, fetcher, { required = false } = {}) {
  let fallback;
  try {
    const response = await fetcher(`https://api.fxtwitter.com/i/status/${id}`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      if (required && [404, 403].includes(response.status)) throw new Error('That X post is unavailable or private.');
      if (required) throw new Error('X could not load that post. Check that it is public and try again.');
      return null;
    }
    fallback = await response.json();
  } catch (error) {
    if (required && (error?.name === 'TimeoutError' || error?.name === 'AbortError')) throw error;
    if (required && error?.message === 'That X post is unavailable or private.') throw error;
    if (required) throw new Error('X could not load that post. Check that it is public and try again.');
    return null;
  }
  if (fallback?.code !== 200 || String(fallback.tweet?.id ?? '') !== String(id)) {
    if (!required) return null;
    if (fallback?.code === 403 || fallback?.code === 404) throw new Error('That X post is unavailable or private.');
    throw new Error('X could not load that post. Check that it is public and try again.');
  }
  return fallback.tweet;
}

async function completeNote(tweet, fetcher) {
  if (!hasUnexpandedNote(tweet)) return tweet;
  const id = statusId(tweet);
  const full = id ? await fetchFxStatus(id, fetcher) : null;
  const text = postText(full);
  if (!text) throw new Error('X returned only a preview for this long post, and its full text is unavailable.');
  const expanded = fromFxStatus(full);
  return {
    ...tweet,
    text,
    full_text: text,
    note_tweet: { ...(typeof tweet.note_tweet === 'object' ? tweet.note_tweet : {}), text },
    quoted_tweet: relatedPost(tweet, 'quote') ?? expanded.quoted_tweet,
    parent: relatedPost(tweet, 'parent') ?? expanded.parent,
    in_reply_to_status_id_str: parentId(tweet) || expanded.in_reply_to_status_id_str
  };
}

async function collectParents(tweet, fetcher) {
  const ancestors = [];
  const seen = new Set([statusId(tweet)]);
  let current = tweet;
  for (let depth = 0; depth < MAX_CONTEXT_DEPTH; depth += 1) {
    const id = parentId(current);
    if (!id || seen.has(id)) break;
    seen.add(id);
    let parent = relatedPost(current, 'parent');
    if (!parent || (statusId(parent) && statusId(parent) !== id)) parent = null;
    if (!parent) parent = await fetchSyndication(id, fetcher);
    if (!parent) {
      const fx = await fetchFxStatus(id, fetcher);
      if (fx) parent = fromFxStatus(fx);
    }
    if (!parent) break;
    parent = await completeNote(parent, fetcher);
    ancestors.push(parent);
    current = parent;
  }
  return ancestors.reverse();
}

async function collectQuotes(posts, fetcher) {
  const quotes = [];
  const seen = new Set();
  for (const post of posts) {
    let current = post;
    for (let depth = 0; depth < 4; depth += 1) {
      let quote = relatedPost(current, 'quote');
      if (!quote) break;
      const id = statusId(quote);
      if (id && seen.has(id)) break;
      if (id) seen.add(id);
      quote = await completeNote(quote, fetcher);
      quotes.push(quote);
      current = quote;
    }
  }
  return quotes;
}

export function appendXContext(body, kind, handle, text) {
  const author = String(handle ?? '').replace(/^@/, '').trim();
  const content = String(text ?? '').trim();
  if (!content || !/^[A-Za-z0-9_]{1,15}$/.test(author)) return body;
  const separator = body ? `${body}\n\n` : '';
  return kind === 'Quoted post'
    ? `${separator}${kind} by @${author}: ${content}`
    : `${separator}${kind} by @${author}:\n${content}`;
}

function bodyForPost(tweet, ancestors, quotes) {
  let body = postText(tweet);
  for (const ancestor of ancestors) body = appendXContext(body, 'Thread context', handleOf(ancestor), postText(ancestor));
  for (const quote of quotes) body = appendXContext(body, 'Quoted post', handleOf(quote), postText(quote));
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    throw new Error('The X post and its conversation context exceed Swartzit’s import size limit.');
  }
  return body;
}

function isMatchingTweet(tweet, id) {
  return tweet && typeof tweet === 'object' && String(tweet.id_str ?? tweet.id ?? '') === id
    && tweet.__typename !== 'TweetTombstone';
}

export async function resolveXConversation(tweet, fetcher = fetch) {
  // Share repeated parent/quote reads within one import and bound total latency.
  const deadline = AbortSignal.timeout(25000);
  const reads = new Map();
  const cachedFetcher = (url, options = {}) => {
    const key = String(url);
    if (!reads.has(key)) reads.set(key, Promise.resolve().then(async () => {
      const response = await fetcher(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline });
      let data;
      const body = () => data ??= response.json();
      return { ok: response.ok, status: response.status, json: body };
    }));
    return reads.get(key);
  };
  let sourceTweet = originalPost(tweet);
  sourceTweet = await completeNote(sourceTweet, cachedFetcher);
  const ancestors = await collectParents(sourceTweet, cachedFetcher);
  const quotes = await collectQuotes([...ancestors, sourceTweet], cachedFetcher);
  return {
    tweet: sourceTweet,
    ancestors,
    quotes,
    body: bodyForPost(sourceTweet, ancestors, quotes),
    media: mediaFromTweet(sourceTweet, ancestors)
  };
}

export async function resolveXPost(raw, fetcher = fetch) {
  const { id, source_url } = parseXStatusUrl(raw);
  let tweet = await fetchSyndication(id, fetcher);

  if (!tweet) {
    const fallback = await fetchFxStatus(id, fetcher, { required: true });
    tweet = fromFxStatus(fallback);
  }

  // When the submitted URL belongs to a repost, the post that was reposted is
  // the source people usually mean to follow. Keep the outer URL for attribution
  // but use the original post's author, text, metrics, and media.
  const { tweet: sourceTweet, body, media } = await resolveXConversation(tweet, fetcher);
  const user = sourceTweet.user ?? tweet.user ?? {};
  const handle = handleOf(sourceTweet) || String(user.screen_name ?? user.username ?? '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('X did not provide a usable public author for this post.');
  const published = Date.parse(sourceTweet.created_at ?? tweet.created_at ?? '');
  const profileImage = trustedUrl(user.profile_image_url_https, 'pbs.twimg.com');
  const profileCount = user.followers_count;
  const followingCount = user.friends_count ?? user.following_count;
  const views = sourceTweet.views?.count;
  return {
    provider: 'x', source_url, source_author: `@${handle}`, title: `Post by @${handle}`,
    body,
    published_at: Number.isFinite(published) ? new Date(published).toISOString() : null,
    observed_at: new Date().toISOString(),
    source_views: count(views), source_likes: count(sourceTweet.favorite_count),
    source_reposts: count(sourceTweet.retweet_count), source_replies: count(sourceTweet.reply_count),
    media, attribution: '',
    profile_image_url: profileImage?.includes('/profile_images/') ? profileImage : null,
    profile_url: `https://x.com/${handle}`,
    profile_display_name: String(user.name ?? '').slice(0, 200) || null,
    profile_bio: String(user.description ?? '').slice(0, 2000) || null,
    profile_followers: count(profileCount), profile_following: count(followingCount),
    profile_verified: user.is_blue_verified === true || user.verified === true
  };
}

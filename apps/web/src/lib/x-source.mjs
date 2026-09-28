const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);

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

function mediaFromTweet(tweet) {
  const result = [];
  for (const post of [tweet, tweet.quoted_tweet].filter(Boolean)) {
    const quotedHandle = post === tweet ? '' : post.user?.screen_name || post.user?.username || 'unknown';
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

function syndicationToken(id) {
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

  const quote = quoteDepth < 3 && status.quote?.type === 'status'
    ? fromFxStatus(status.quote, quoteDepth + 1)
    : null;
  return {
    id_str: String(status.id ?? ''),
    text: typeof status.text === 'string' ? status.text : '',
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
    ...(quote ? { quoted_tweet: quote } : {})
  };
}

function isMatchingTweet(tweet, id) {
  return tweet && typeof tweet === 'object' && String(tweet.id_str ?? tweet.id ?? '') === id
    && tweet.__typename !== 'TweetTombstone';
}

export async function resolveXPost(raw, fetcher = fetch) {
  const { id, source_url } = parseXStatusUrl(raw);
  const syndicationUrl = new URL('https://cdn.syndication.twimg.com/tweet-result');
  syndicationUrl.searchParams.set('id', id);
  syndicationUrl.searchParams.set('lang', 'en');
  syndicationUrl.searchParams.set('token', syndicationToken(id));
  let tweet = null;
  try {
    const response = await fetcher(syndicationUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (response.ok) {
      const result = await response.json();
      if (isMatchingTweet(result, id)) tweet = result;
    }
  } catch {
    // Try the public read fallback below when the syndication endpoint is unavailable.
  }

  if (!tweet) {
    let fallback;
    try {
      const response = await fetcher(`https://api.fxtwitter.com/i/status/${id}`, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 403) throw new Error('That X post is unavailable or private.');
        throw new Error('X could not load that post. Check that it is public and try again.');
      }
      fallback = await response.json();
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
      if (error?.message === 'That X post is unavailable or private.') throw error;
      throw new Error('X could not load that post. Check that it is public and try again.');
    }

    if (fallback?.code === 403 || fallback?.code === 404) {
      throw new Error('That X post is unavailable or private.');
    }
    if (fallback?.code !== 200 || String(fallback.tweet?.id ?? '') !== id) {
      throw new Error('X could not load that post. Check that it is public and try again.');
    }
    tweet = fromFxStatus(fallback.tweet);
  }

  // When the submitted URL belongs to a repost, the post that was reposted is
  // the source people usually mean to follow. Keep the outer URL for attribution
  // but use the original post's author, text, metrics, and media.
  const sourceTweet = originalPost(tweet);
  const user = sourceTweet.user ?? tweet.user ?? {};
  const handle = String(user.screen_name ?? user.username ?? '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('X did not provide a usable public author for this post.');
  let body = String(sourceTweet.text ?? sourceTweet.full_text ?? '').trim();
  const quoted = sourceTweet.quoted_tweet;
  const quotedText = String(quoted?.text ?? quoted?.full_text ?? '').trim();
  const quotedHandle = String(quoted?.user?.screen_name ?? quoted?.user?.username ?? '').replace(/^@/, '');
  if (body && quotedText && quotedHandle && !body.includes(`Quoted post by @${quotedHandle}:`)) {
    body += `\n\nQuoted post by @${quotedHandle}: ${quotedText}`;
  }
  const published = Date.parse(sourceTweet.created_at ?? tweet.created_at ?? '');
  const profileImage = trustedUrl(user.profile_image_url_https, 'pbs.twimg.com');
  const profileCount = user.followers_count;
  const followingCount = user.friends_count ?? user.following_count;
  const views = sourceTweet.views?.count;
  return {
    provider: 'x', source_url, source_author: `@${handle}`, title: `Post by @${handle}`,
    body: body.slice(0, 50000),
    published_at: Number.isFinite(published) ? new Date(published).toISOString() : null,
    observed_at: new Date().toISOString(),
    source_views: count(views), source_likes: count(sourceTweet.favorite_count),
    source_reposts: count(sourceTweet.retweet_count), source_replies: count(sourceTweet.reply_count),
    media: mediaFromTweet(sourceTweet), attribution: '',
    profile_image_url: profileImage?.includes('/profile_images/') ? profileImage : null,
    profile_url: `https://x.com/${handle}`,
    profile_display_name: String(user.name ?? '').slice(0, 200) || null,
    profile_bio: String(user.description ?? '').slice(0, 2000) || null,
    profile_followers: count(profileCount), profile_following: count(followingCount),
    profile_verified: user.is_blue_verified === true || user.verified === true
  };
}

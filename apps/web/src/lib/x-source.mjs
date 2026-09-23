const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);

export function parseXStatusUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Paste a public X post link.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('That does not look like a valid link.'); }
  if (url.protocol !== 'https:' || !X_HOSTS.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Use a public post link from x.com or twitter.com.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts.length === 3 && parts[1] === 'status' && /^\d{1,24}$/.test(parts[2])
    ? parts[2]
    : parts.length === 3 && parts[0] === 'i' && parts[1] === 'status' && /^\d{1,24}$/.test(parts[2])
      ? parts[2]
      : null;
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

export async function resolveXPost(raw, fetcher = fetch) {
  const { id, source_url } = parseXStatusUrl(raw);
  const response = await fetcher(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=0`, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('X could not load that post. Check that it is public and try again.');
  const tweet = await response.json();
  if (String(tweet.id_str ?? tweet.id ?? '') !== id) throw new Error('That X post is unavailable or private.');
  const user = tweet.user ?? {};
  const handle = String(user.screen_name ?? user.username ?? '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('X did not provide a usable public author for this post.');
  let body = String(tweet.text ?? tweet.full_text ?? '').trim();
  const quoted = tweet.quoted_tweet;
  const quotedText = String(quoted?.text ?? quoted?.full_text ?? '').trim();
  const quotedHandle = String(quoted?.user?.screen_name ?? quoted?.user?.username ?? '').replace(/^@/, '');
  if (body && quotedText && quotedHandle && !body.includes(`Quoted post by @${quotedHandle}:`)) {
    body += `\n\nQuoted post by @${quotedHandle}: ${quotedText}`;
  }
  const published = Date.parse(tweet.created_at ?? '');
  const profileImage = trustedUrl(user.profile_image_url_https, 'pbs.twimg.com');
  const profileCount = user.followers_count;
  const followingCount = user.friends_count ?? user.following_count;
  const views = tweet.views?.count;
  return {
    provider: 'x', source_url, source_author: `@${handle}`, title: `Post by @${handle}`,
    body: body.slice(0, 50000),
    published_at: Number.isFinite(published) ? new Date(published).toISOString() : null,
    observed_at: new Date().toISOString(),
    source_views: count(views), source_likes: count(tweet.favorite_count),
    source_reposts: count(tweet.retweet_count), source_replies: count(tweet.reply_count),
    media: mediaFromTweet(tweet), attribution: '',
    profile_image_url: profileImage?.includes('/profile_images/') ? profileImage : null,
    profile_url: `https://x.com/${handle}`,
    profile_display_name: String(user.name ?? '').slice(0, 200) || null,
    profile_bio: String(user.description ?? '').slice(0, 2000) || null,
    profile_followers: count(profileCount), profile_following: count(followingCount),
    profile_verified: user.is_blue_verified === true || user.verified === true
  };
}

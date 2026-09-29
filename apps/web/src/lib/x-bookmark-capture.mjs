// Normalize responses actually delivered to the signed-in X bookmark page.
// Does not store cookies, request headers, credentials, or call private APIs.
const count = value => { const n = Number(value); return value != null && Number.isSafeInteger(n) && n >= 0 ? n : null; };
const byteLength = value => new TextEncoder().encode(value).length;
const bounded = (value, max) => { let out = ''; for (const c of String(value ?? '')) { if (byteLength(out + c) > max) break; out += c; } return out; };
function trusted(raw, host) {
  try { const u = new URL(raw); return u.protocol === 'https:' && u.hostname === host && !u.username && !u.password && !u.port ? u.toString() : null; }
  catch { return null; }
}
const unwrap = result => result?.tweet ?? result;

function normalizeTweet(raw, observedAt, depth = 0) {
  const tweet = unwrap(raw), legacy = tweet?.legacy;
  const id = tweet?.rest_id ?? legacy?.id_str;
  const user = tweet?.core?.user_results?.result;
  const profile = user?.core ?? user?.legacy ?? {};
  const handle = profile.screen_name;
  if (!legacy || !/^\d{1,24}$/.test(id || '') || !/^[A-Za-z0-9_]{1,15}$/.test(handle || '')) throw new Error('Post or author is unavailable.');
  if ((user.privacy?.protected ?? user.legacy?.protected) !== false || tweet.__typename === 'TweetTombstone') throw new Error('Protected or unavailable source was not published.');
  if (legacy.withheld_in_countries?.length || legacy.withheld_scope) throw new Error('Withheld source was not published.');
  const note = tweet.note_tweet?.note_tweet_results?.result;
  let body = note?.text ?? legacy.full_text ?? '';
  if (tweet.note_tweet && !note?.text) throw new Error('Full text is unavailable for this long post.');
  for (const entity of [...(legacy.entities?.urls ?? []), ...(note?.entity_set?.urls ?? [])]) {
    if (entity.url && entity.expanded_url) body = body.split(entity.url).join(entity.expanded_url);
  }
  body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const media = [];
  for (const item of legacy.extended_entities?.media ?? []) {
    const image = trusted(item.media_url_https, 'pbs.twimg.com');
    const alt = bounded(item.ext_alt_text, 1000);
    if (item.type === 'photo' && image) media.push({ kind: 'image', src: image, ...(alt ? { alt } : {}) });
    else if (['video', 'animated_gif'].includes(item.type)) {
      const variant = (item.video_info?.variants ?? []).filter(v => v.content_type === 'video/mp4' && trusted(v.url, 'video.twimg.com') && new URL(v.url).pathname.endsWith('.mp4')).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (!variant) throw new Error('Video has no playable MP4 variant.');
      media.push({ kind: 'video', src: variant.url, ...(image ? { poster: image } : {}), ...(alt ? { alt } : {}) });
    }
  }
  let sensitive = Boolean(legacy.possibly_sensitive || user.possibly_sensitive);
  const quote = unwrap(tweet.quoted_status_result?.result);
  if (quote && depth < 3) {
    try {
      const record = normalizeTweet(quote, observedAt, depth + 1);
      body += `\n\nQuoted post by ${record.source_author}: ${record.body}`;
      media.push(...record.media);
      sensitive ||= record.content_rating === 'x';
    } catch { body += '\n\nQuoted post unavailable for public import.'; }
  }
  if (byteLength(body) > 250000) throw new Error('Full text exceeds the 250 KB post limit.');
  const uniqueMedia = [...new Map(media.map(item => [item.src, item])).values()];
  if (uniqueMedia.length > 8) throw new Error('Post and quote have more than eight attachments.');
  const date = Date.parse(legacy.created_at);
  const image = trusted(user.avatar?.image_url ?? user.legacy?.profile_image_url_https, 'pbs.twimg.com');
  return {
    community: 'x_imports', provider: 'x', source_url: `https://x.com/i/status/${id}`,
    source_author: `@${handle}`, title: `Post by @${handle}`, body,
    content_rating: sensitive ? 'x' : 'general',
    published_at: Number.isFinite(date) ? new Date(date).toISOString() : null, observed_at: observedAt,
    source_views: count(tweet.views?.count), source_likes: count(legacy.favorite_count),
    source_reposts: count(legacy.retweet_count), source_replies: count(legacy.reply_count),
    media: uniqueMedia, attribution: '',
    profile_image_url: image?.includes('/profile_images/') ? image : null,
    profile_url: `https://x.com/${handle}`, profile_display_name: bounded(profile.name, 200) || null,
    profile_bio: bounded(user.profile_bio?.description ?? user.legacy?.description, 2000) || null,
    profile_followers: count(user.relationship_counts?.followers ?? user.legacy?.followers_count),
    profile_following: count(user.relationship_counts?.following ?? user.legacy?.friends_count),
    profile_verified: user.is_blue_verified === true || user.verification?.verified === true
  };
}

export function readXBookmarkCapture(payload, { observedAt } = {}) {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('A capture timestamp is required.');
  const instructions = payload?.data?.bookmark_timeline_v2?.timeline?.instructions;
  if (!Array.isArray(instructions)) throw new Error('Not an X bookmark timeline response.');
  const posts = [], unavailable = [];
  let bottomCursor = null, terminated = false;
  for (const instruction of instructions) {
    if (instruction.type === 'TimelineTerminateTimeline' && instruction.direction === 'Bottom') terminated = true;
    for (const entry of instruction.entries ?? []) {
      const content = entry.content;
      if (content?.cursorType === 'Bottom') bottomCursor = content.value;
      if (!entry.entryId?.startsWith('tweet-')) continue;
      const id = entry.entryId.slice(6);
      try {
        const post = normalizeTweet(content?.itemContent?.tweet_results?.result, observedAt);
        if (post.source_url !== `https://x.com/i/status/${id}`) throw new Error('Timeline ID does not match post ID.');
        posts.push(post);
      } catch (cause) { unavailable.push({ id, reason: cause.message }); }
    }
  }
  return { posts, unavailable, bottomCursor, terminated };
}

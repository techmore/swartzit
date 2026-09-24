const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const SHORT_YOUTUBE_HOSTS = new Set(['youtu.be']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function parseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim().length > 2048) throw new Error('Paste a public YouTube video link.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('That does not look like a valid link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Use a public HTTPS link from YouTube.');
  }
  return url;
}

function videoId(url) {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (SHORT_YOUTUBE_HOSTS.has(host) && parts.length === 1 && VIDEO_ID.test(parts[0])) return parts[0];
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return VIDEO_ID.test(id || '') ? id : null;
  }
  if (parts.length === 2 && ['embed', 'live', 'shorts'].includes(parts[0]) && VIDEO_ID.test(parts[1])) return parts[1];
  return null;
}

export function parseYouTubeUrl(raw) {
  const url = parseUrl(raw);
  const id = videoId(url);
  if (!id) throw new Error('Use a link to one YouTube video, not a channel, playlist, or feed.');
  return {
    id,
    source_url: `https://www.youtube.com/watch?v=${id}`,
    embed_url: `https://www.youtube-nocookie.com/embed/${id}`
  };
}

export function youtubeEmbedUrl(raw) {
  try { return parseYouTubeUrl(raw).embed_url; } catch { return null; }
}

function bounded(value, fallback, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  return text || fallback;
}

export async function resolveYouTubePost(raw, fetcher = fetch) {
  const { id, source_url } = parseYouTubeUrl(raw);
  let metadata = {};
  try {
    const response = await fetcher(`https://www.youtube.com/oembed?url=${encodeURIComponent(source_url)}&format=json`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) metadata = await response.json();
  } catch {
    // Metadata is optional. The canonical URL is enough to render the embed.
  }
  return {
    provider: 'youtube',
    source_url,
    source_author: 'YouTube',
    title: bounded(metadata.title, `YouTube video ${id}`, 300),
    body: '',
    published_at: null,
    observed_at: new Date().toISOString(),
    source_views: null,
    source_likes: null,
    source_reposts: null,
    source_replies: null,
    media: [],
    source_comments: [],
    attribution: 'Embedded from YouTube; the video remains hosted by YouTube.',
    profile_image_url: null,
    profile_url: null,
    profile_display_name: bounded(metadata.author_name, 'YouTube', 200),
    profile_bio: null,
    profile_followers: null,
    profile_following: null,
    profile_verified: null
  };
}

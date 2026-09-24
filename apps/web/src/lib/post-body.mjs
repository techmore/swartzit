import { parseYouTubeUrl } from './youtube-source.mjs';

const URL_TOKEN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[),.;!?\]}]+$/;

function sourceUrl(value) {
  let candidate = value;
  while (TRAILING_PUNCTUATION.test(candidate)) candidate = candidate.slice(0, -1);
  return candidate;
}

export function parsePostBody(value) {
  const embeds = [];
  const text = String(value ?? '').replace(URL_TOKEN, candidate => {
    const url = sourceUrl(candidate);
    let parsed;
    try { parsed = parseYouTubeUrl(url); } catch { return candidate; }
    if (!embeds.some(embed => embed.embed_url === parsed.embed_url)) {
      embeds.push({ source_url: parsed.source_url, embed_url: parsed.embed_url });
    }
    return '';
  })
    .replace(/[ \t]+([,.;!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, embeds };
}

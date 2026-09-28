import { parseXStatusUrl } from './x-source.mjs';
import { parseRedditPostUrl } from './reddit-source.mjs';
import { parseYouTubeUrl } from './youtube-source.mjs';

const URL_TOKEN = /https:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[),.;!?\]}]+$/;

function sourceUrl(value) {
  let candidate = value;
  while (TRAILING_PUNCTUATION.test(candidate)) candidate = candidate.slice(0, -1);
  return candidate;
}

export function parseCommentDraft(value) {
  const body = String(value ?? '');
  const matches = [];

  for (const match of body.matchAll(URL_TOKEN)) {
    const rawUrl = sourceUrl(match[0]);
    try {
      const parsed = parseXStatusUrl(rawUrl);
      matches.push({ provider: 'x', sourceUrl: parsed.source_url, token: match[0] });
    } catch {
      try {
        const parsed = parseRedditPostUrl(rawUrl);
        matches.push({ provider: 'reddit', sourceUrl: parsed.source_url, token: match[0] });
      } catch {
        try {
          const parsed = parseYouTubeUrl(rawUrl);
          matches.push({ provider: 'youtube', sourceUrl: parsed.source_url, token: match[0] });
        } catch {
          // Other links stay in the comment as regular text.
        }
      }
    }
  }

  if (matches.length > 1) {
    return { body, sourceUrl: '', provider: '', error: 'Share one external post per comment.' };
  }
  if (!matches.length) return { body: body.trim(), sourceUrl: '', provider: '', error: '' };

  const text = body.replace(matches[0].token, ' ')
    .replace(/[ \t]+([,.;!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body: text, sourceUrl: matches[0].sourceUrl, provider: matches[0].provider, error: '' };
}

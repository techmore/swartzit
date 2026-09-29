const clean = value => String(value ?? '').trim();
export function cleanXSourceText(value, source = {}) {
    let body = clean(value);
    // X syndication sometimes appends its own video title, player clock and
    // engagement counts to extracted profile-page text. The actual video is
    // rendered from source.media, so keep that player chrome out of the copy.
    const contextStart = body.search(/\n\n(?:Quoted post|Thread context) by @[^:\n]+:/i);
    const context = contextStart >= 0 ? body.slice(contextStart) : '';
    const postText = contextStart >= 0 ? body.slice(0, contextStart) : body;
    body = postText.replace(/\nFrom\s*\n[^\n]+\n\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}[\s\S]*$/i, '') + context;
    const lines = body.split(/\r?\n/);
    while (lines.length) {
      const line = lines[0].trim();
      if (!line || line === source.profile_display_name || line === source.source_author || line === '·' || line === 'Fan account' || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i.test(line)) lines.shift();
      else break;
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
export function splitXPost(value) {
    const body = clean(value);
    const marker = /(^|\n\n)(Quoted post|Thread context) by (@[A-Za-z0-9_]{1,15}):\s*/gi;
    const matches = [...body.matchAll(marker)];
    if (!matches.length) return { text: body, threadContexts: [], quotedPosts: [] };
    const contexts = matches.map((match, index) => {
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? body.length;
      return { kind: match[2].toLowerCase(), author: match[3], text: body.slice(start, end).trim() };
    }).filter(context => context.text);
    return {
      text: body.slice(0, matches[0].index).trim(),
      threadContexts: contexts.filter(context => context.kind === 'thread context'),
      quotedPosts: contexts.filter(context => context.kind === 'quoted post')
    };
  }

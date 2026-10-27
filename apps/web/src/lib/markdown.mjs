// A small, deliberately conservative Markdown subset for post bodies.
//
// Output is a plain tree (never an HTML string), so the renderer can emit real
// elements and there is no HTML injection surface. Raw HTML in the source is
// just text. Only http(s) and mailto links are ever produced.
//
// Posts written as plain text must keep looking the same: single newlines
// stay visible as line breaks, and lone `*`, `_` or `#` characters are left
// alone unless they form real Markdown.

const FENCE = /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;

const TRAILING = /[),.;:!?\]}'"]+$/;

export function safeHref(value) {
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

const INLINE_RULES = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'link', re: /\[([^\]\n]+)\]\(([^\s)]+)\)/ },
  { type: 'strong', re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*(?!\*)|__(?=\S)([\s\S]+?)(?<=\S)__(?!_)/ },
  { type: 'em', re: /(?<![*\w])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![*\w])|(?<![_\w])_(?![\s_])([^_\n]+?)(?<![\s_])_(?![_\w])/ },
  { type: 'url', re: /https?:\/\/[^\s<>"']+/ }
];

function pushText(nodes, text) {
  if (!text) return;
  const parts = text.split('\n');
  parts.forEach((part, index) => {
    if (index > 0) nodes.push({ type: 'br' });
    if (part) nodes.push({ type: 'text', value: part });
  });
}

export function parseInline(source, depth = 0) {
  const nodes = [];
  let rest = String(source ?? '');
  while (rest) {
    let best = null;
    for (const rule of INLINE_RULES) {
      const match = rule.re.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { rule, match };
    }
    if (!best) { pushText(nodes, rest); break; }
    const { rule, match } = best;
    pushText(nodes, rest.slice(0, match.index));
    let consumed = match[0];
    if (rule.type === 'code') {
      nodes.push({ type: 'code', value: match[1] });
    } else if (rule.type === 'link') {
      const href = safeHref(match[2]);
      if (href) nodes.push({ type: 'link', href, children: depth < 3 ? parseInline(match[1], depth + 1) : [{ type: 'text', value: match[1] }] });
      else pushText(nodes, match[0]);
    } else if (rule.type === 'url') {
      let url = match[0];
      while (TRAILING.test(url)) url = url.slice(0, -1);
      consumed = url;
      const href = safeHref(url);
      if (href) nodes.push({ type: 'link', href, children: [{ type: 'text', value: url }] });
      else pushText(nodes, url);
    } else {
      const inner = match[1] ?? match[2];
      nodes.push({ type: rule.type, children: depth < 3 ? parseInline(inner, depth + 1) : [{ type: 'text', value: inner }] });
    }
    rest = rest.slice(match.index + consumed.length);
  }
  return nodes;
}

function listIndent(line) {
  return line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
}

function parseList(lines, start, ordered) {
  const matcher = ordered ? ORDERED : BULLET;
  const baseIndent = listIndent(lines[start]);
  const items = [];
  let index = start;
  let first = null;
  while (index < lines.length) {
    const line = lines[index];
    const match = matcher.exec(line);
    if (!match || listIndent(line) !== baseIndent) break;
    if (ordered && first === null) first = Number(match[2]);
    const text = ordered ? match[3] : match[2];
    const item = { inline: parseInline(text), children: [] };
    index += 1;
    // Nested lists and soft-wrapped continuation lines belong to this item.
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim()) break;
      const indent = listIndent(next);
      if (indent > baseIndent && (BULLET.test(next) || ORDERED.test(next))) {
        const nestedOrdered = ORDERED.test(next) && !BULLET.test(next);
        const nested = parseList(lines, index, nestedOrdered);
        item.children.push(nested.node);
        index = nested.next;
      } else if (indent > baseIndent && !BULLET.test(next) && !ORDERED.test(next)) {
        item.inline.push({ type: 'br' }, ...parseInline(next.trim()));
        index += 1;
      } else break;
    }
    items.push(item);
  }
  return { node: { type: 'list', ordered, start: ordered ? first : null, items }, next: index };
}

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) { body.push(lines[index]); index += 1; }
      index += 1;
      blocks.push({ type: 'code', lang: fence[2] || '', value: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) }); index += 1; continue; }
    if (RULE.test(line) && !BULLET.test(line)) { blocks.push({ type: 'rule' }); index += 1; continue; }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) { quoted.push(QUOTE.exec(lines[index])[1]); index += 1; }
      blocks.push({ type: 'quote', children: parseMarkdown(quoted.join('\n')) });
      continue;
    }
    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !BULLET.test(line);
      const list = parseList(lines, index, ordered);
      blocks.push(list.node);
      index = list.next;
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim()
      && !FENCE.test(lines[index]) && !HEADING.test(lines[index]) && !QUOTE.test(lines[index])
      && !(RULE.test(lines[index]) && !BULLET.test(lines[index]))
      && !BULLET.test(lines[index]) && !ORDERED.test(lines[index])) {
      paragraph.push(lines[index].trimEnd());
      index += 1;
    }
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

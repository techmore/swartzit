import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInline, parseMarkdown, safeHref } from './markdown.mjs';

const text = nodes => nodes.map(n => n.type === 'br' ? '\n' : n.value ?? text(n.children ?? [])).join('');

test('headings, paragraphs and rules become blocks', () => {
  const blocks = parseMarkdown('### Chapter 1\n\nFirst line\nsecond line\n\n---\n\nEnd');
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'paragraph', 'rule', 'paragraph']);
  assert.equal(blocks[0].level, 3);
  assert.equal(text(blocks[0].children), 'Chapter 1');
});

test('single newlines in plain text stay as visible line breaks', () => {
  const [paragraph] = parseMarkdown('line one\nline two');
  assert.deepEqual(paragraph.children.map(n => n.type), ['text', 'br', 'text']);
});

test('bold, italic and code are recognised, including nesting', () => {
  const nodes = parseInline('a **bold *and italic*** and `x_y` and *density*');
  assert.equal(nodes.find(n => n.type === 'strong').children.some(n => n.type === 'em'), true);
  assert.equal(nodes.find(n => n.type === 'code').value, 'x_y');
  assert.equal(nodes.filter(n => n.type === 'em').length, 1);
});

test('plain text with stray markers is left alone', () => {
  for (const sample of ['5 * 3 * 2', 'snake_case_name here', 'a_b and c_d', '2 ** 3', 'cost #1 is low']) {
    const nodes = parseInline(sample);
    assert.equal(nodes.every(n => n.type === 'text'), true, sample);
    assert.equal(text(nodes), sample);
  }
});

test('lists, nested lists and ordered start numbers', () => {
  const [ul, ol] = parseMarkdown('- one\n- two\n  - nested\n- three\n\n3. third\n4. fourth');
  assert.equal(ul.type, 'list');
  assert.equal(ul.items.length, 3);
  assert.equal(ul.items[1].children[0].items.length, 1);
  assert.equal(ol.ordered, true);
  assert.equal(ol.start, 3);
});

test('code fences keep content verbatim and do not parse markdown inside', () => {
  const [code] = parseMarkdown('```js\nconst a = **1**;\n```');
  assert.equal(code.type, 'code');
  assert.equal(code.lang, 'js');
  assert.equal(code.value, 'const a = **1**;');
});

test('block quotes nest parsed content', () => {
  const [quote] = parseMarkdown('> quoted **text**\n> more');
  assert.equal(quote.type, 'quote');
  assert.equal(quote.children[0].type, 'paragraph');
});

test('only http, https and mailto links are produced', () => {
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,<b>'), '');
  assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
  const nodes = parseInline('[click](javascript:alert(1)) and [ok](https://example.com)');
  assert.equal(nodes.filter(n => n.type === 'link').length, 1);
  assert.match(text(nodes), /\[click\]\(javascript:alert\(1\)\)/);
});

test('bare URLs become links without trailing punctuation', () => {
  const link = parseInline('see https://example.com/path.').find(n => n.type === 'link');
  assert.equal(link.href, 'https://example.com/path');
});

test('raw HTML is never interpreted', () => {
  const blocks = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[0].children.every(n => n.type === 'text'), true);
});

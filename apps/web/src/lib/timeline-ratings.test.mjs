import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from '../routes/+page.server.js';

test('timeline defaults to General and preserves explicit rating opt-ins', async () => {
  for (const [query, expected] of [
    ['', {hide_r: 'true', hide_x: 'true'}],
    ['?show_r=true', {hide_r: 'false', hide_x: 'true'}],
    ['?hide_r=false&show_x=true', {hide_r: 'false', hide_x: 'false'}],
    ['?feed=rated&ratings=x', {ratings: 'x'}],
    ['?feed=rated&ratings=rx', {ratings: 'rx'}]
  ]) {
    let params;
    await load({url: new URL(`https://example.test/${query}`), fetch: async path => {
      if (path.startsWith('/api/posts?')) {
        params = new URL(path, 'https://example.test').searchParams;
        return Response.json({posts: [], has_more: false});
      }
      return Response.json([]);
    }});
    for (const [key, value] of Object.entries(expected)) assert.equal(params.get(key), value, query);
    if (expected.ratings) {
      assert.equal(params.has('hide_r'), false);
      assert.equal(params.has('hide_x'), false);
    }
  }
});

test('Biblical mode scopes the default timeline but not communities or Everything', async () => {
  for (const [query, enabled, expected] of [
    ['', true, 'bible'],
    ['?scope=all', true, null],
    ['?community=sermons', true, null],
    ['?feed=rated', true, null],
    ['', false, null]
  ]) {
    let params;
    const data = await load({url: new URL(`https://example.test/${query}`), parent: async () => ({bible: {enabled, communities: []}}), fetch: async path => {
      if (path.startsWith('/api/posts?')) {
        params = new URL(path, 'https://example.test').searchParams;
        return Response.json({posts: [], has_more: false});
      }
      return Response.json([]);
    }});
    assert.equal(params.get('scope'), expected, `${query} enabled=${enabled}`);
    assert.equal(Boolean(data.reading), enabled, query);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPostUrl, publicOrigin } from './public-origin.mjs';

test('the configured origin wins over the request origin', () => {
  assert.equal(publicOrigin('http://127.0.0.1:5173/post/abc', { SWARTZIT_ORIGIN: ' https://commons.example ' }), 'https://commons.example');
  assert.equal(publicOrigin('http://127.0.0.1:5173/post/abc', { SWARTZIT_ORIGIN: 'https://commons.example/base/path' }), 'https://commons.example');
});

test('a missing or invalid configuration falls back to the request origin', () => {
  assert.equal(publicOrigin('https://my-instance.example/post/abc?x=1', {}), 'https://my-instance.example');
  assert.equal(publicOrigin('https://my-instance.example/post/abc', { SWARTZIT_ORIGIN: 'not a url' }), 'https://my-instance.example');
  assert.equal(publicOrigin('https://my-instance.example/post/abc', { SWARTZIT_ORIGIN: 'ftp://files.example' }), 'https://my-instance.example');
  assert.equal(publicOrigin('garbage', {}), '');
});

test('canonical post links encode the public id', () => {
  assert.equal(canonicalPostUrl('https://commons.example', 'abc'), 'https://commons.example/post/abc');
  assert.equal(canonicalPostUrl('https://commons.example', 'a b/c'), 'https://commons.example/post/a%20b%2Fc');
});

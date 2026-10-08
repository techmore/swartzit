import assert from 'node:assert/strict';
import test from 'node:test';
import { apiUrl } from './api-url.mjs';

test('API address follows runtime configuration and preserves relative fallback', () => {
  const original = process.env.API_URL;
  try {
    delete process.env.API_URL;
    assert.equal(apiUrl(), 'http://127.0.0.1:8080');
    assert.equal(apiUrl(''), '');
    process.env.API_URL = ' http://127.0.0.1:18080 ';
    assert.equal(apiUrl(), 'http://127.0.0.1:18080');
    process.env.API_URL = 'http://127.0.0.1:18081';
    assert.equal(apiUrl(), 'http://127.0.0.1:18081');
  } finally {
    if (original === undefined) delete process.env.API_URL;
    else process.env.API_URL = original;
  }
});

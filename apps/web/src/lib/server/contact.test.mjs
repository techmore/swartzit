import test from 'node:test';
import assert from 'node:assert/strict';
import { contactEmail } from './contact.mjs';

test('only a plausible address is shown', () => {
  assert.equal(contactEmail(' help@example.org '), 'help@example.org');
  assert.equal(contactEmail('not an email'), null);
  assert.equal(contactEmail(''), null);
  assert.equal(contactEmail(undefined), null);
});

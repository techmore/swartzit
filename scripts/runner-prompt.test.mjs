import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRunnerPrompt, RUNNER_PROMPT_TOKENS} from './runner-prompt.mjs';

test('renders deterministic date and runner context tokens', () => {
  const result = renderRunnerPrompt(
    '{date} {time} {weekday} {runner} {community} {author} {run_id} {seed} {index}/{total} {dry_run}',
    {
      now: '2026-09-23T16:05:07.000Z',
      runner: 'Daily art',
      community: 'general',
      author: 'editor',
      runId: 42,
      seed: 77,
      index: 2,
      total: 4,
      dryRun: true
    }
  );
  assert.equal(result, '2026-09-23 16:05 Wednesday Daily art general editor 42 77 2/4 true');
});

test('leaves unknown tokens intact and uses automatic seed by default', () => {
  assert.equal(
    renderRunnerPrompt('Keep {unknown}; seed={seed}; author={author}', {author: 'editor'}),
    'Keep {unknown}; seed=automatic; author=editor'
  );
});

test('renders explicit prompt permutation variables without overriding built-ins', () => {
  assert.equal(
    renderRunnerPrompt('{lighting} {date} {index}', {
      now: '2026-09-23T00:00:00.000Z',
      variables: {lighting: 'soft daylight', date: 'not allowed'},
      index: 2
    }),
    'soft daylight 2026-09-23 2'
  );
});

test('publishes the supported token list for UI and documentation', () => {
  assert.ok(RUNNER_PROMPT_TOKENS.includes('{date}'));
  assert.ok(RUNNER_PROMPT_TOKENS.includes('{index}'));
  assert.equal(new Set(RUNNER_PROMPT_TOKENS).size, RUNNER_PROMPT_TOKENS.length);
});

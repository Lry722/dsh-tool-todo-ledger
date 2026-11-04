import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_POLICY, reviewRequest, reviewResult } from '../src/prompts.js';

test('external prompts load and interpolate review data verbatim', () => {
  assert.match(REVIEW_POLICY, /Review the proposed todo_write operation/);
  for (const prompt of [REVIEW_POLICY, reviewRequest([], {})]) {
    assert.doesNotMatch(prompt, /\b(?:ledger|stateless|step|top-level|1-based)\b/i);
  }
  assert.equal(
    reviewResult('warning', 'Keep $& literal.'),
    'AGENTS.md review warning: Keep $& literal.',
  );
  const instructions = [{ source: { kind: 'agent-instructions' }, text: 'Keep $& and {{todoWrite}} literal.' }];
  const pending = { todos: ['Preserve $` and $\' in JSON'] };
  assert.equal(reviewRequest(instructions, pending), [
    'CURRENT_PROJECT_INSTRUCTIONS',
    JSON.stringify(instructions, null, 2),
    'PROPOSED_TODO_WRITE',
    JSON.stringify(pending, null, 2),
  ].join('\n\n'));
});

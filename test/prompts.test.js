import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORTING_SECTION, REVIEW_POLICY, reviewRequest, reviewResult } from '../src/prompts.js';

test('external prompts load and interpolate review data verbatim', () => {
  assert.match(REPORTING_SECTION, /For each new request, call todo_write before any other tool/);
  assert.match(REPORTING_SECTION, /every assistant message/);
  assert.match(REPORTING_SECTION, /exactly one todo_report call/);
  assert.match(REPORTING_SECTION, /no other tool calls/);
  assert.match(REPORTING_SECTION, /An issue is a concrete piece of work/);
  assert.match(REPORTING_SECTION, /Issues are only report labels/);
  assert.doesNotMatch(REPORTING_SECTION, /local task|localTask/i);
  assert.doesNotMatch(REPORTING_SECTION, /text-only/);
  assert.match(REVIEW_POLICY, /Review the proposed todo_write operation/);
  for (const prompt of [REPORTING_SECTION, REVIEW_POLICY, reviewRequest([], {})]) {
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

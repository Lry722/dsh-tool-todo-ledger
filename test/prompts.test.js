import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARD_MESSAGES,
  LEDGER_MESSAGES,
  NOTICES,
  REVIEW_POLICY,
  TOOL_MESSAGES,
  fillPrompt,
  reviewError,
  reviewRequest,
  reviewResult,
} from '../src/prompts.js';

test('external prompts load and interpolate review data verbatim', () => {
  assert.match(REVIEW_POLICY, /Review the proposed todo_write operation/);
  for (const prompt of [REVIEW_POLICY, reviewRequest([], {})]) {
    assert.doesNotMatch(prompt, /\b(?:ledger|stateless|step|top-level|1-based)\b/i);
  }
  assert.equal(
    reviewResult('warning', 'Keep $& literal.'),
    'AGENTS.md review warning: Keep $& literal.',
  );
  assert.equal(reviewResult('passed'), 'No AGENTS.md violation found.');
  assert.equal(reviewResult('noInstructions'), 'No active AGENTS.md instructions to review.');
  const instructions = [{ source: { kind: 'agent-instructions' }, text: 'Keep $& and {{todoWrite}} literal.' }];
  const pending = { todos: ['Preserve $` and $\' in JSON'] };
  assert.equal(reviewRequest(instructions, pending), [
    'CURRENT_PROJECT_INSTRUCTIONS',
    JSON.stringify(instructions, null, 2),
    'PROPOSED_TODO_WRITE',
    JSON.stringify(pending, null, 2),
  ].join('\n\n'));
});

test('runtime messages load and interpolate prompt placeholders', () => {
  assert.equal(GUARD_MESSAGES.duplicateReport, '单个步骤只能调用一次 todo_report。');
  assert.equal(
    GUARD_MESSAGES.standaloneReport,
    'todo_report 不能单独调用，必须与同一步骤中的动作工具一起调用。',
  );
  assert.match(GUARD_MESSAGES.coverageWarning.one, /最后一次警告/);
  assert.match(GUARD_MESSAGES.coverageWarning.many, /你忘了调用 todo_report/);
  // Coverage warnings demand the missing report; they must not announce how much
  // of the exemption allowance is left.
  assert.doesNotMatch(GUARD_MESSAGES.coverageWarning.one, /\{\{/);
  assert.doesNotMatch(GUARD_MESSAGES.coverageWarning.many, /\{\{/);
  assert.equal(
    fillPrompt(LEDGER_MESSAGES.taskIndexRange, { tool: 'todo_write', count: 3 }),
    'todo_write: task index must be between 1 and 3',
  );
  assert.equal(
    fillPrompt(TOOL_MESSAGES.requiresAgent, { tool: 'todo_read' }),
    'todo_read requires an owning agent session',
  );
  assert.equal(
    reviewError('failed', { kind: 'error', message: 'boom' }).message,
    'reviewer ended with error: boom',
  );
  assert.match(
    fillPrompt(NOTICES.guardFailure, { error: 'projection unavailable' }),
    /projection unavailable.*allowed to continue/,
  );
  assert.equal(fillPrompt('Leave {{unknown}} intact', {}), 'Leave {{unknown}} intact');
});

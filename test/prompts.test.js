import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARD_MESSAGES,
  LEDGER_MESSAGES,
  NOTICES,
  TOOL_MESSAGES,
  fillPrompt,
} from '../src/prompts.js';

test('runtime messages load and interpolate prompt placeholders', () => {
  assert.equal(
    GUARD_MESSAGES.standaloneReport,
    'todo_report 不能单独调用，必须与同一次回复中的其他工具一起调用。',
  );
  assert.match(GUARD_MESSAGES.coverageWarning.one, /最后一次警告/);
  assert.match(GUARD_MESSAGES.coverageWarning.many, /你忘了调用 todo_report/);
  // Coverage warnings demand the missing report; they must not announce how much
  // of the exemption allowance is left.
  assert.doesNotMatch(GUARD_MESSAGES.coverageWarning.one, /\{\{/);
  assert.doesNotMatch(GUARD_MESSAGES.coverageWarning.many, /\{\{/);
  assert.match(GUARD_MESSAGES.repeatedIssue, /\{\{issue\}\}/);
  const repeatedIssue = fillPrompt(GUARD_MESSAGES.repeatedIssue, { issue: '查询 API' });
  assert.match(repeatedIssue, /查询 API/);
  assert.match(repeatedIssue, /省略 issue/);
  assert.doesNotMatch(repeatedIssue, /\{\{/);
  assert.match(GUARD_MESSAGES.unreportedFinish, /\{\{index\}\}/);
  const unreportedFinish = fillPrompt(GUARD_MESSAGES.unreportedFinish, { index: 2 });
  assert.match(unreportedFinish, /再次调用同一个 finish 确认/);
  assert.match(unreportedFinish, /reorderFrom: 2/);
  assert.doesNotMatch(unreportedFinish, /\{\{/);
  assert.match(GUARD_MESSAGES.unrecordedReports, /\{\{active\}\}/);
  const unrecordedReports = fillPrompt(GUARD_MESSAGES.unrecordedReports, { active: '2「合入 master」' });
  assert.match(unrecordedReports, /所有工具调用将被拦截/);
  assert.match(unrecordedReports, /2「合入 master」/);
  assert.doesNotMatch(unrecordedReports, /\{\{/);
  // Assert interpolation behavior instead of the current language so that
  // localizing ledger messages never breaks this test.
  assert.match(LEDGER_MESSAGES.taskIndexRange, /\{\{tool\}\}/);
  assert.match(LEDGER_MESSAGES.taskIndexRange, /\{\{count\}\}/);
  const taskIndexRange = fillPrompt(LEDGER_MESSAGES.taskIndexRange, { tool: 'todo_write', count: 3 });
  assert.notEqual(taskIndexRange, LEDGER_MESSAGES.taskIndexRange);
  assert.match(taskIndexRange, /todo_write/);
  assert.match(taskIndexRange, /1/);
  assert.match(taskIndexRange, /3/);
  assert.doesNotMatch(taskIndexRange, /\{\{/);
  assert.equal(
    fillPrompt(TOOL_MESSAGES.requiresAgent, { tool: 'todo_read' }),
    'todo_read requires an owning agent session',
  );
  assert.match(
    fillPrompt(NOTICES.guardFailure, { error: 'projection unavailable' }),
    /projection unavailable.*allowed to continue/,
  );
  assert.equal(fillPrompt('Leave {{unknown}} intact', {}), 'Leave {{unknown}} intact');
});

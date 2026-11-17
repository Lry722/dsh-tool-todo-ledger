import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoverageBudget,
  inProgressTask,
  installReportGuard,
  installStepTracker,
  repeatedIssue,
  stepCoverage,
  stepReportTargets,
  unreportedFinish,
} from '../src/guard.js';
import { stepToolCalls } from '../src/step.js';
import {
  LEDGER_VERSION,
  emptyLedger,
  finishLedger,
  foldLedgerEvent,
  legacyTodos,
  startLedger,
  updateLedger,
  writeLedger,
} from '../src/ledger.js';

const call = (name, id = `${name}-call`, args = {}) => ({
  type: 'tool-call',
  id,
  name,
  arguments: JSON.stringify(args),
});
const message = (...calls) => ({ content: calls });
const execution = (rootCallId, name = 'bash', callId = rootCallId) => ({ rootCallId, name, callId });
const ptcExecution = (rootCallId, name, dispatch = 1) => ({
  rootCallId,
  name,
  callId: `${rootCallId}:ptc:${dispatch}`,
});

function inProgressLedger() {
  return startLedger(writeLedger(emptyLedger(), ['Task']).state, 1).state;
}

function reportedLedger(callId = 'todo_report-call') {
  const state = inProgressLedger();
  return foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 10,
    time: 1000,
    data: {
      todos: legacyTodos(state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'report',
        taskId: 't1',
        callId,
        report: { index: 1, inIssue: false },
      },
    },
  });
}

function reportIssue(state, issue = '查询 DSH API', callId = 'issue-report-call', seq = 10) {
  return foldLedgerEvent(state, {
    type: 'todo/write',
    seq,
    time: seq * 100,
    data: {
      todos: legacyTodos(state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'report',
        taskId: 't1',
        callId,
        report: { index: 1, inIssue: true, issue },
      },
    },
  });
}

function issueReportedLedger(issue = '查询 DSH API', callId = 'issue-report-call') {
  return reportIssue(inProgressLedger(), issue, callId);
}

function addReport(state, seq, callId) {
  return foldLedgerEvent(state, {
    type: 'todo/write',
    seq,
    time: seq * 100,
    data: {
      todos: legacyTodos(state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'report',
        taskId: 't1',
        callId,
        report: { index: 1, inIssue: false },
      },
    },
  });
}

test('todo-only steps need no report and remain exempt', () => {
  const step = message(call('todo_write'), call('todo_read'));
  assert.equal(stepCoverage(undefined, step, execution('todo_write-call')).outcome, 'exempt');
});

test('a report must accompany another tool but need not lead it', () => {
  for (const step of [
    message(call('todo_report')),
    message(call('todo_report'), call('todo_report', 'second-report')),
  ]) {
    assert.match(
      stepCoverage(undefined, step, execution('todo_report-call')).reason,
      /不能单独调用/,
    );
  }
  for (const step of [
    message(call('todo_report'), call('todo_read')),
    message(call('todo_read'), call('todo_report')),
    message(call('todo_report'), call('todo_write')),
    message(call('todo_write'), call('todo_report')),
    message(call('todo_report'), call('bash')),
    message(call('bash'), call('todo_report')),
  ]) {
    assert.equal(stepCoverage(undefined, step, execution('todo_report-call')).outcome, 'exempt');
  }
});

test('work requires an in-progress main task', () => {
  const step = message(call('todo_report'), call('bash'));
  assert.match(stepCoverage(emptyLedger(), step, execution('bash-call')).reason, /没有进行中的任务/);
  assert.equal(stepCoverage(reportedLedger(), step, execution('bash-call')).outcome, 'covered');
});

test('a first write later in the same step admits an action as bootstrap', () => {
  const step = message(call('bash', 'bash-call'), call('todo_write', 'write-call', { todos: ['Task'] }));
  assert.deepEqual(stepCoverage(emptyLedger(), step, execution('bash-call')), { outcome: 'bootstrap' });

  // Without a write in the step the empty plan stays a hard violation, and a
  // write that already ran earlier cannot admit a task-less action either.
  assert.match(
    stepCoverage(emptyLedger(), message(call('bash', 'bash-call')), execution('bash-call')).reason,
    /没有进行中的任务/,
  );
  assert.match(
    stepCoverage(
      emptyLedger(),
      message(call('todo_write', 'write-call'), call('bash', 'bash-call')),
      execution('bash-call'),
    ).reason,
    /没有进行中的任务/,
  );
  // A later finish-only write cannot create the missing task either.
  assert.match(
    stepCoverage(
      emptyLedger(),
      message(call('bash', 'bash-call'), call('todo_write', 'write-call', { finish: 1 })),
      execution('bash-call'),
    ).reason,
    /没有进行中的任务/,
  );
});

test('stepReportTargets resolves report indices against the current plan', () => {
  const state = startLedger(writeLedger(emptyLedger(), ['One', 'Two']).state, 1).state;
  assert.deepEqual(
    [...stepReportTargets(state, message(
      call('todo_report', 'report-1', { index: 1, inIssue: false }),
      call('todo_report', 'report-2', { index: 2, inIssue: false }),
      call('todo_report', 'report-bad', { index: 9, inIssue: false }),
      call('bash'),
    ))],
    ['t1', 't2'],
  );
  assert.equal(
    stepReportTargets(emptyLedger(), message(call('todo_report', 'report-1', { index: 1 }))).size,
    0,
  );
  // A look-ahead boundary excludes calls that already ran.
  assert.deepEqual(
    [...stepReportTargets(
      state,
      message(
        call('todo_report', 'report-1', { index: 1, inIssue: false }),
        call('todo_report', 'report-2', { index: 2, inIssue: false }),
      ),
      'report-1',
    )],
    ['t2'],
  );
  // A reorder rebases every later index, so the look-ahead stops at it.
  const reordered = message(
    call('todo_write', 'finish-call', { finish: 1 }),
    call('todo_report', 'report-before', { index: 2, inIssue: false }),
    call('todo_write', 'reindex-call', { reorderFrom: 2, todos: ['New'] }),
    call('todo_report', 'report-after', { index: 2, inIssue: false }),
  );
  assert.deepEqual([...stepReportTargets(state, reordered, 'finish-call')], ['t2']);
  const onlyAfter = message(
    call('todo_write', 'finish-call', { finish: 1 }),
    call('todo_write', 'reindex-call', { reorderFrom: 2, todos: ['New'] }),
    call('todo_report', 'report-after', { index: 2, inIssue: false }),
  );
  assert.equal(stepReportTargets(state, onlyAfter, 'finish-call').size, 0);
});

test('coverage separates missing and failed reports from pending reports', () => {
  const missing = message(call('bash'));
  assert.deepEqual(stepCoverage(reportedLedger(), missing, execution('bash-call')), {
    outcome: 'uncovered',
    coverage: 'missing',
  });

  const failed = message(call('todo_report'), call('bash'));
  assert.deepEqual(stepCoverage(inProgressLedger(), failed, execution('bash-call')), {
    outcome: 'uncovered',
    coverage: 'failed',
  });
  assert.deepEqual(stepCoverage(reportedLedger('other-report'), failed, execution('bash-call')), {
    outcome: 'uncovered',
    coverage: 'failed',
  });

  const late = message(call('bash'), call('todo_report', 'late-report'));
  assert.deepEqual(stepCoverage(reportedLedger(), late, execution('bash-call')), {
    outcome: 'provisional',
  });
  assert.equal(stepCoverage(reportedLedger(), late, execution('late-report')).outcome, 'exempt');

  const duplicated = message(call('todo_report'), call('todo_report', 'second-report'), call('bash'));
  assert.equal(stepCoverage(reportedLedger(), duplicated, execution('bash-call')).outcome, 'covered');
  assert.equal(stepCoverage(reportedLedger('second-report'), duplicated, execution('bash-call')).outcome, 'covered');
  assert.deepEqual(stepCoverage(inProgressLedger(), duplicated, execution('bash-call')), {
    outcome: 'uncovered',
    coverage: 'failed',
  });
});

test('calls outside the tracked assistant step are exempt', () => {
  const unmatched = message(call('bash'));
  assert.equal(stepCoverage(reportedLedger(), unmatched, execution('read-call')).outcome, 'exempt');
  assert.equal(stepCoverage(reportedLedger(), undefined, execution('bash-call')).outcome, 'exempt');
});

test('nested PTC sub-calls are judged by their own name, not the run_code container', () => {
  const step = message(call('run_code', 'run_code-call'));
  assert.equal(stepCoverage(reportedLedger(), step, execution('run_code-call', 'run_code')).outcome, 'exempt');
  assert.equal(
    stepCoverage(reportedLedger(), step, ptcExecution('run_code-call', 'todo_write')).outcome,
    'exempt',
  );
  assert.deepEqual(
    stepCoverage(reportedLedger(), step, ptcExecution('run_code-call', 'bash')),
    { outcome: 'provisional' },
  );
});

test('PTC programs can bootstrap an empty ledger but still gate actions on a task', () => {
  const step = message(call('run_code', 'run_code-call'));
  const outer = execution('run_code-call', 'run_code');
  assert.equal(stepCoverage(emptyLedger(), step, outer).outcome, 'exempt');

  const write = ptcExecution('run_code-call', 'todo_write');
  const action = ptcExecution('run_code-call', 'bash');
  assert.equal(stepCoverage(emptyLedger(), step, write).outcome, 'exempt');
  assert.match(stepCoverage(emptyLedger(), step, action).reason, /没有进行中的任务/);
  assert.equal(stepCoverage(inProgressLedger(), step, action).outcome, 'provisional');
});

test('a PTC report is never rejected as a standalone message call', () => {
  const step = message(call('run_code', 'run_code-call'));
  assert.equal(
    stepCoverage(emptyLedger(), step, ptcExecution('run_code-call', 'todo_report')).outcome,
    'exempt',
  );
});

test('coverage budget grants 3, 2 then 1 exemptions before blocking', () => {
  const budget = createCoverageBudget();
  const admissions = Array.from({ length: 7 }, () => budget.admit());
  assert.deepEqual(admissions.map((admission) => admission.allowed), [
    true, true, true, true, true, true, false,
  ]);
  assert.match(admissions[0].warning, /你忘了调用 todo_report/);
  assert.match(admissions[3].warning, /你忘了调用 todo_report/);
  assert.match(admissions[5].warning, /最后一次警告/);
  assert.equal(admissions[6].warning, undefined);
  const warnings = admissions.slice(0, 6).map((admission) => admission.warning).filter(Boolean);
  for (const warning of warnings) {
    // Warnings must push for the missing report without revealing the slack left.
    assert.doesNotMatch(warning, /\d/);
  }
});

test('a recorded report resets the exemption budget', () => {
  const budget = createCoverageBudget();
  budget.admit();
  budget.admit();
  budget.reset();
  assert.match(budget.admit().warning, /你忘了调用 todo_report/);
});

function guardHarness(initialState = reportedLedger(), budget = createCoverageBudget(), steerOverride) {
  let state = initialState;
  let step;
  let guard;
  const warnings = [];
  const listeners = new Map();
  const ctx = {
    on(type, fn) {
      listeners.set(type, fn);
      return () => listeners.delete(type);
    },
    sessionProjections: {
      stateOf() {
        return state;
      },
    },
  };
  const agent = {
    session: { id: 'session-1' },
    steer(input) {
      if (steerOverride) return steerOverride(input, warnings);
      warnings.push(input);
    },
    ctx: {
      tools: {
        guard(fn) {
          guard = fn;
          return () => {};
        },
      },
    },
  };
  installReportGuard(ctx, agent, () => step, budget);
  return {
    warnings,
    setState(next) {
      state = next;
    },
    setStep(next) {
      step = next;
    },
    fire(type, event) {
      listeners.get(type)?.(agent.session, event);
    },
    run(rootCallId = 'bash-call', name = 'bash', callId = rootCallId, args) {
      return guard({ agent, rootCallId, name, callId, arguments: args });
    },
  };
}

test('repeatedIssue only matches an explicit continuation of the active issue', () => {
  const state = issueReportedLedger();
  const report = (args) => repeatedIssue(state, { arguments: args });
  assert.deepEqual(report({ index: 1, inIssue: true, issue: '查询 DSH API' }), {
    taskId: 't1',
    issue: '查询 DSH API',
  });
  assert.deepEqual(report({ index: 1, inIssue: true, issue: ' 查询 DSH API ' }), {
    taskId: 't1',
    issue: '查询 DSH API',
  });
  // An omitted name is the documented way to continue an issue.
  assert.equal(report({ index: 1, inIssue: true }), undefined);
  assert.equal(report({ index: 1, inIssue: true, issue: '另一个 issue' }), undefined);
  assert.equal(report({ index: 1, inIssue: false }), undefined);
  assert.equal(report(undefined), undefined);
  assert.equal(
    repeatedIssue(reportedLedger(), { arguments: { inIssue: true, issue: '查询 DSH API' } }),
    undefined,
  );
  assert.equal(
    repeatedIssue(emptyLedger(), { arguments: { inIssue: true, issue: '查询 DSH API' } }),
    undefined,
  );

  // Reorder keeps t1 in progress but clears the continuation target; the next
  // issue must be named even when it matches the old name.
  let reordered = startLedger(writeLedger(emptyLedger(), ['Task', 'Next']).state, 1).state;
  reordered = reportIssue(reordered);
  reordered = writeLedger(reordered, ['Replacement'], 2).state;
  assert.equal(reordered.lastReportTaskId, null);
  assert.equal(inProgressTask(reordered).id, 't1');
  assert.equal(
    repeatedIssue(reordered, { arguments: { inIssue: true, issue: '查询 DSH API' } }),
    undefined,
  );
});

test('unreportedFinish only matches an active task without reports', () => {
  const state = inProgressLedger();
  assert.deepEqual(unreportedFinish(state, { arguments: { finish: 1 } }), {
    index: 1,
    taskId: 't1',
  });
  assert.equal(unreportedFinish(reportedLedger(), { arguments: { finish: 1 } }), undefined);
  assert.equal(unreportedFinish(state, { arguments: { finish: 2 } }), undefined);
  assert.equal(unreportedFinish(state, { arguments: { finish: 0 } }), undefined);
  assert.equal(unreportedFinish(state, { arguments: { todos: ['Next'] } }), undefined);
  assert.equal(unreportedFinish(state, { arguments: undefined }), undefined);
  assert.equal(unreportedFinish(emptyLedger(), { arguments: { finish: 1 } }), undefined);
  assert.equal(
    unreportedFinish(finishLedger(state, 1).state, { arguments: { finish: 1 } }),
    undefined,
  );
});

test('the first finish of an unreported task asks for confirmation', () => {
  const h = guardHarness(inProgressLedger());
  h.setStep(message(call('todo_write'), call('bash')));
  const finish = { finish: 1 };

  const denial = h.run('todo_write-call', 'todo_write', 'todo_write-call', finish);
  assert.match(denial, /没有任何 todo_report/);
  assert.match(denial, /再次调用同一个 finish 确认/);
  assert.match(denial, /reorderFrom: 1/);

  // The second attempt is the explicit declaration of a no-action output task.
  assert.equal(h.run('todo_write-call', 'todo_write', 'todo_write-call', finish), undefined);
  assert.equal(h.warnings.length, 0);
});

test('a report later in the same step satisfies the finish confirmation', () => {
  const h = guardHarness(inProgressLedger());
  h.setStep(message(
    call('todo_write', 'write-call', { finish: 1 }),
    call('todo_report', 'report-call', { index: 1, inIssue: false }),
  ));
  assert.equal(h.run('write-call', 'todo_write', 'write-call', { finish: 1 }), undefined);
  assert.equal(h.warnings.length, 0);
});

test('a report that already ran does not satisfy the finish confirmation', () => {
  const h = guardHarness(inProgressLedger());
  h.setStep(message(
    call('todo_report', 'report-call', { index: 1, inIssue: false }),
    call('todo_write', 'write-call', { finish: 1 }),
  ));
  // The earlier report has no effect on the state, so it must have failed; only
  // a report that is still ahead of the finish can be looked up.
  assert.match(
    h.run('write-call', 'todo_write', 'write-call', { finish: 1 }),
    /没有任何 todo_report/,
  );
});

test('a report for another task does not satisfy the finish confirmation', () => {
  const state = startLedger(writeLedger(emptyLedger(), ['One', 'Two']).state, 1).state;
  const h = guardHarness(state);
  h.setStep(message(
    call('todo_write', 'write-call', { finish: 1 }),
    call('todo_report', 'report-call', { index: 2, inIssue: false }),
  ));
  assert.match(
    h.run('write-call', 'todo_write', 'write-call', { finish: 1 }),
    /没有任何 todo_report/,
  );
});

test('a report makes the finish confirmation unnecessary', () => {
  const h = guardHarness(inProgressLedger());
  h.setStep(message(call('todo_write')));
  assert.match(
    h.run('todo_write-call', 'todo_write', 'todo_write-call', { finish: 1 }),
    /reorderFrom/,
  );

  h.setState(reportedLedger());
  assert.equal(h.run('todo_write-call', 'todo_write', 'todo_write-call', { finish: 1 }), undefined);
});

test('a PTC finish without reports uses the same confirmation', () => {
  const h = guardHarness(inProgressLedger());
  h.setStep(message(call('run_code', 'run_code-call')));
  assert.match(
    h.run('run_code-call', 'todo_write', 'run_code-call:ptc:1', { finish: 1 }),
    /reorderFrom: 1/,
  );
  assert.equal(
    h.run('run_code-call', 'todo_write', 'run_code-call:ptc:1', { finish: 1 }),
    undefined,
  );
});

test('a retired finish confirmation does not authorize a later finish', () => {
  const h = guardHarness(inProgressLedger());
  const finish = { finish: 1 };
  h.setStep(message(call('todo_write')));
  assert.match(h.run('todo_write-call', 'todo_write', 'todo_write-call', finish), /reorderFrom/);

  // Reordering the task away retires the confirmation: it belonged to a plan
  // that no longer exists and must not leak into a replacement task.
  h.setState(writeLedger(inProgressLedger(), ['Replacement'], 1).state);
  h.setStep(message(call('todo_write')));
  assert.equal(h.run('todo_write-call', 'todo_write', 'todo_write-call', { todos: ['Next'] }), undefined);

  // Recreating an unreported in-progress task asks for confirmation again.
  h.setState(inProgressLedger());
  h.setStep(message(call('todo_write')));
  assert.match(h.run('todo_write-call', 'todo_write', 'todo_write-call', finish), /reorderFrom/);
});

test('a repeated active issue gets one steer that asks to omit the name', () => {
  const h = guardHarness(issueReportedLedger());
  h.setStep(message(call('todo_report'), call('bash')));
  const repeated = { index: 1, inIssue: true, issue: '查询 DSH API' };

  assert.equal(h.run('todo_report-call', 'todo_report', 'todo_report-call', repeated), undefined);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /查询 DSH API/);
  assert.match(h.warnings[0].content[0].text, /省略 issue/);

  // The report still runs; only one steer per issue streak is sent.
  assert.equal(h.run('todo_report-call', 'todo_report', 'todo_report-call', repeated), undefined);
  assert.equal(h.warnings.length, 1);
});

test('omitting the continued issue clears the steer for a later relapse', () => {
  const h = guardHarness(issueReportedLedger());
  h.setStep(message(call('todo_report'), call('bash')));
  const repeated = { index: 1, inIssue: true, issue: '查询 DSH API' };

  h.run('todo_report-call', 'todo_report', 'todo_report-call', repeated);
  assert.equal(h.warnings.length, 1);

  // Compliance: continue the same issue without restating its name.
  assert.equal(
    h.run('todo_report-call', 'todo_report', 'todo_report-call', { index: 1, inIssue: true }),
    undefined,
  );
  assert.equal(h.warnings.length, 1);

  h.run('todo_report-call', 'todo_report', 'todo_report-call', repeated);
  assert.equal(h.warnings.length, 2);
  assert.match(h.warnings[1].content[0].text, /省略 issue/);
});

test('a failed steer is retried on the next duplicate report', () => {
  let attempts = 0;
  const h = guardHarness(issueReportedLedger(), createCoverageBudget(), (input, warnings) => {
    attempts += 1;
    // A transient delivery failure must not consume the once-per-streak steer.
    if (attempts === 1) throw new Error('steering unavailable');
    warnings.push(input);
  });
  h.setStep(message(call('todo_report'), call('bash')));
  const repeated = { index: 1, inIssue: true, issue: '查询 DSH API' };

  assert.equal(h.run('todo_report-call', 'todo_report', 'todo_report-call', repeated), undefined);
  assert.equal(attempts, 1);
  assert.equal(h.warnings.length, 0);

  assert.equal(h.run('todo_report-call', 'todo_report', 'todo_report-call', repeated), undefined);
  assert.equal(attempts, 2);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /省略 issue/);
});

test('a repeated issue in a PTC report steers the same way', () => {
  const h = guardHarness(issueReportedLedger());
  h.setStep(message(call('run_code', 'run_code-call')));
  assert.equal(
    h.run('run_code-call', 'todo_report', 'run_code-call:ptc:1', {
      index: 1,
      inIssue: true,
      issue: '查询 DSH API',
    }),
    undefined,
  );
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /省略 issue/);
});

test('missing reports are exempted with one steer per warning round', () => {
  const h = guardHarness();

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /你忘了调用 todo_report/);

  assert.equal(h.run('second-call'), undefined);
  assert.equal(h.warnings.length, 1);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 1);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 2);
  assert.match(h.warnings[1].content[0].text, /你忘了调用 todo_report/);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 2);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 3);
  assert.match(h.warnings[2].content[0].text, /最后一次警告/);

  h.setStep(message(call('bash')));
  assert.match(h.run(), /所有工具调用将被拦截/);
  assert.equal(h.warnings.length, 3);
});

test('failed reports consume the budget silently and eventually block', () => {
  const h = guardHarness(reportedLedger('earlier-report'));
  for (let step = 0; step < 6; step += 1) {
    h.setStep(message(call('todo_report'), call('bash')));
    assert.equal(h.run(), undefined);
  }
  assert.equal(h.warnings.length, 0);

  h.setStep(message(call('todo_report'), call('bash')));
  assert.match(h.run(), /所有工具调用将被拦截/);
});

test('a recorded report restores the full exemption grant', () => {
  const h = guardHarness();
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 1);

  h.setState(reportedLedger('next-report'));
  h.setStep(message(call('todo_report', 'next-report'), call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 1);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 2);
  assert.match(h.warnings[1].content[0].text, /你忘了调用 todo_report/);
});

test('a report recorded outside an action step still restores the grant', () => {
  const h = guardHarness();
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 1);

  h.setState(reportedLedger('standalone-report'));
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 2);
  assert.match(h.warnings[1].content[0].text, /你忘了调用 todo_report/);
});

test('a report on a finished task still resets the budget after a task switch', () => {
  const h = guardHarness();
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 1);

  let state = addReport(reportedLedger(), 20, 'later-report');
  state = finishLedger(state, 1).state;
  state = writeLedger(state, ['Second']).state;
  state = startLedger(state, 2).state;
  h.setState(state);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 2);
  assert.match(h.warnings[1].content[0].text, /你忘了调用 todo_report/);
});

test('a mid-message finish hard-blocks later actions instead of reusing the cached pass', () => {
  const initial = reportedLedger();
  const h = guardHarness(initial);
  const step = message(
    call('todo_report'),
    call('bash', 'bash1'),
    call('todo_write', 'write1'),
    call('bash', 'bash2'),
  );
  h.setStep(step);
  assert.equal(h.run('bash1'), undefined);

  const state = finishLedger(initial, 1).state;
  h.setState(state);
  const coverage = stepCoverage(state, step, execution('bash2'));
  assert.equal(coverage.outcome, 'blocked');
  assert.match(coverage.reason, /当前没有进行中的任务/);
  assert.match(h.run('bash2'), /当前没有进行中的任务/);
  assert.equal(h.warnings.length, 0);
});

test('a mid-message task switch rechecks coverage and spends the message admission', () => {
  const h = guardHarness(reportedLedger(), createCoverageBudget(1));
  const step = message(
    call('todo_report'),
    call('bash', 'bash1'),
    call('todo_write', 'write1'),
    call('bash', 'bash2'),
  );
  h.setStep(step);
  assert.equal(h.run('bash1'), undefined);
  assert.equal(h.warnings.length, 0);

  let state = writeLedger(reportedLedger(), ['Second']).state;
  state = updateLedger(state, { finish: 1 }).state;
  h.setState(state);
  assert.equal(inProgressTask(state).id, 't2');
  assert.deepEqual(stepCoverage(state, step, execution('bash2')), {
    outcome: 'uncovered',
    coverage: 'failed',
  });

  assert.equal(h.run('bash2'), undefined);
  assert.equal(h.warnings.length, 0);

  h.setStep(message(call('bash', 'bash3')));
  assert.match(h.run('bash3'), /所有工具调用将被拦截/);
  assert.equal(h.warnings.length, 0);
});

test('one assistant message spends at most one coverage admission', () => {
  const h = guardHarness(reportedLedger(), createCoverageBudget(1));
  h.setStep(message(call('bash', 'bash1'), call('bash', 'bash2')));
  assert.equal(h.run('bash1'), undefined);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /你忘了调用 todo_report/);

  assert.equal(h.run('bash2'), undefined);
  assert.equal(h.warnings.length, 1);

  h.setStep(message(call('bash', 'bash3')));
  assert.match(h.run('bash3'), /所有工具调用将被拦截/);
  assert.equal(h.warnings.length, 1);
});

test('a reported call covers later actions in the same message without another admission', () => {
  let state = inProgressLedger();
  const h = guardHarness(state);
  const step = message(
    call('todo_report'),
    call('bash', 'bash1'),
    call('bash', 'bash2'),
  );
  h.setStep(step);
  assert.deepEqual(stepCoverage(state, step, execution('bash1')), {
    outcome: 'uncovered',
    coverage: 'failed',
  });
  assert.equal(h.run('bash1'), undefined);
  assert.equal(h.warnings.length, 0);

  state = addReport(state, 10, 'todo_report-call');
  h.setState(state);
  assert.deepEqual(stepCoverage(state, step, execution('bash2')), { outcome: 'covered' });
  assert.equal(h.run('bash2'), undefined);
  assert.equal(h.warnings.length, 0);

  h.setStep(message(call('bash', 'bash3')));
  assert.equal(h.run('bash3'), undefined);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /你忘了调用 todo_report/);
});

function ptcDispatch(parentCallId, name, isError = false) {
  return { type: 'tool/ptc-dispatch', data: { parentCallId, name, isError } };
}

function toolResult(callId) {
  return { type: 'tool/result', data: { message: { callId } } };
}

test('a PTC program that reports does not spend the coverage budget', () => {
  const h = guardHarness(reportedLedger(), createCoverageBudget(1));
  h.setStep(message(call('run_code', 'run_code-call')));
  assert.equal(h.run('run_code-call', 'run_code'), undefined);
  assert.equal(h.run('run_code-call', 'bash', 'run_code-call:ptc:1'), undefined);
  assert.equal(h.run('run_code-call', 'todo_report', 'run_code-call:ptc:2'), undefined);
  h.fire('session/event', ptcDispatch('run_code-call', 'bash'));
  h.fire('session/event', ptcDispatch('run_code-call', 'todo_report'));
  h.fire('session/event', toolResult('run_code-call'));
  assert.equal(h.warnings.length, 0);
});

test('uncovered PTC programs escalate to a pending report requirement', () => {
  const h = guardHarness(reportedLedger(), createCoverageBudget(1));
  h.setStep(message(call('run_code', 'run_code-call')));

  // First uncovered program: admitted with a warning.
  assert.equal(h.run('run_code-call', 'run_code'), undefined);
  assert.equal(h.run('run_code-call', 'bash', 'run_code-call:ptc:1'), undefined);
  h.fire('session/event', ptcDispatch('run_code-call', 'bash'));
  h.fire('session/event', toolResult('run_code-call'));
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /你忘了调用 todo_report/);

  // Second uncovered program exhausts the budget and requires a report.
  assert.equal(h.run('run_code-call', 'run_code'), undefined);
  assert.equal(h.run('run_code-call', 'bash', 'run_code-call:ptc:1'), undefined);
  h.fire('session/event', ptcDispatch('run_code-call', 'bash'));
  h.fire('session/event', toolResult('run_code-call'));
  assert.equal(h.warnings.length, 2);
  assert.match(h.warnings[1].content[0].text, /没有成功调用 todo_report/);

  assert.match(h.run('run_code-call', 'bash', 'run_code-call:ptc:1'), /没有成功调用 todo_report/);
  // Todo tools remain available so the program can recover.
  assert.equal(h.run('run_code-call', 'todo_write', 'run_code-call:ptc:2'), undefined);

  assert.equal(h.run('run_code-call', 'todo_report', 'run_code-call:ptc:3'), undefined);
  h.fire('session/event', ptcDispatch('run_code-call', 'todo_report'));
  h.fire('session/event', toolResult('run_code-call'));
  assert.equal(h.run('run_code-call', 'bash', 'run_code-call:ptc:1'), undefined);
});

test('a PTC program that bootstraps a task can then run an action', () => {
  let state = emptyLedger();
  const h = guardHarness(state, createCoverageBudget(1));
  h.setStep(message(call('run_code', 'run_code-call')));
  assert.equal(h.run('run_code-call', 'run_code'), undefined);
  assert.equal(h.run('run_code-call', 'todo_write', 'run_code-call:ptc:1'), undefined);

  state = startLedger(writeLedger(state, ['Task']).state, 1).state;
  h.setState(state);
  assert.equal(h.run('run_code-call', 'bash', 'run_code-call:ptc:2'), undefined);
});

test('a plan without an in-progress task remains a hard block', () => {
  const h = guardHarness();
  h.setState(emptyLedger());
  h.setStep(message(call('todo_report'), call('bash')));
  assert.match(h.run(), /没有进行中的任务/);
  assert.equal(h.run('todo_report-call', 'todo_report'), undefined);
});

test('a standalone report is rejected even when a work decision is cached', () => {
  const h = guardHarness();
  h.setStep(message(call('todo_report')));
  assert.match(h.run('todo_report-call', 'todo_report'), /不能单独调用/);
});

test('a late report is admitted and leaves no steer behind', () => {
  const h = guardHarness();
  h.setStep(message(call('bash'), call('todo_report', 'late-report')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 0);
});

test('recorded late reports never consume the exemption budget', () => {
  const h = guardHarness(reportedLedger('earlier-report'));
  for (let step = 0; step < 10; step += 1) {
    h.setStep(message(call('bash'), call('todo_report', `late-${step}`)));
    assert.equal(h.run(), undefined);
    // The late report runs after the action and lands before the next step.
    h.setState(reportedLedger(`late-${step}`));
  }
  assert.equal(h.warnings.length, 0);
});

test('a late report that never records stops granting provisional passage', () => {
  const h = guardHarness(reportedLedger('earlier-report'));
  // The first late report is admitted before it can be verified; every following
  // step admits only the hope of a new report, so it must spend the budget.
  for (let step = 0; step < 7; step += 1) {
    h.setStep(message(call('bash'), call('todo_report', `late-${step}`)));
    assert.equal(h.run(), undefined);
  }
  assert.equal(h.warnings.length, 0);

  h.setStep(message(call('bash'), call('todo_report', 'late-final')));
  const denial = h.run();
  assert.match(denial, /所有工具调用将被拦截/);
  // The block names the active task so a wrong-index report can be corrected.
  assert.match(denial, /当前进行中的任务是 1「Task」/);
  assert.equal(h.warnings.length, 0);
});

test('a recorded report restores the late-report grant', () => {
  const h = guardHarness(reportedLedger('earlier-report'));
  for (let step = 0; step < 5; step += 1) {
    h.setStep(message(call('bash'), call('todo_report', `late-${step}`)));
    assert.equal(h.run(), undefined);
  }
  assert.equal(h.warnings.length, 0);

  // A report that lands between steps resets the budget and re-arms the grant.
  h.setState(reportedLedger('recovered-report'));
  h.setStep(message(call('bash'), call('todo_report', 'recovered-late')));
  assert.equal(h.run(), undefined);

  // A fresh broken streak may again spend the full grant before blocking.
  for (let step = 0; step < 6; step += 1) {
    h.setStep(message(call('bash'), call('todo_report', `late-again-${step}`)));
    assert.equal(h.run(), undefined);
  }
  h.setStep(message(call('bash'), call('todo_report', 'late-again-final')));
  assert.match(h.run(), /所有工具调用将被拦截/);
  assert.equal(h.warnings.length, 0);
});

test('a projection failure notifies the user and lets the call continue', () => {
  const notices = [];
  const errors = [];
  let guard;
  const ctx = {
    on() {},
    logger: { error: (text) => errors.push(text) },
    sessionProjections: {
      stateOf() {
        throw new Error('projection unavailable');
      },
    },
  };
  const agent = {
    session: { id: 'session-1' },
    inject(message) {
      notices.push(message);
    },
    ctx: {
      tools: {
        guard(fn) {
          guard = fn;
          return () => {};
        },
      },
    },
  };
  installReportGuard(ctx, agent, () => message(call('todo_report'), call('bash')));
  assert.equal(guard({ agent: agent.session, rootCallId: 'bash-call', name: 'bash' }), undefined);
  assert.equal(notices.length, 1);
  assert.match(notices[0].content[0].text, /could not verify a tool call/);
  assert.match(notices[0].content[0].text, /projection unavailable/);
  assert.equal(notices[0].source.form, 'notice');
  assert.equal(notices[0].source.summary, 'Todo ledger guard failure');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /projection unavailable/);

  assert.equal(guard({ agent: agent.session, rootCallId: 'bash-call', name: 'bash' }), undefined);
  assert.equal(notices.length, 1);
  assert.equal(errors.length, 1);
});

test('inProgressTask finds the active node and ignores malformed state', () => {
  assert.equal(inProgressTask(inProgressLedger()).content, 'Task');
  assert.equal(inProgressTask(emptyLedger()), undefined);
  assert.equal(inProgressTask(undefined), undefined);
});

test('stepToolCalls tolerates missing assistant content', () => {
  assert.deepEqual(stepToolCalls(message(call('bash'))), [call('bash')]);
  assert.deepEqual(stepToolCalls(undefined), []);
  assert.deepEqual(stepToolCalls({}), []);
});

function trackerHarness() {
  const listeners = new Map();
  const ctx = {
    on(type, fn) {
      listeners.set(type, fn);
      return () => listeners.delete(type);
    },
  };
  const stepOf = installStepTracker(ctx);
  const session = { id: 'session-1' };
  return {
    session,
    stepOf,
    fire(type, event) {
      listeners.get(type)?.(session, event);
    },
  };
}

function assistantEvent(...calls) {
  return { type: 'assistant/message', data: { message: { content: calls } } };
}

test('step tracker retains only the latest completed assistant step', () => {
  const env = trackerHarness();
  assert.equal(env.stepOf(env.session), undefined);
  env.fire('session/event', assistantEvent(call('bash')));
  assert.deepEqual(env.stepOf(env.session), message(call('bash')));

  env.fire('session/event', { type: 'assistant/message', data: { interrupted: true, message: { content: [] } } });
  assert.deepEqual(env.stepOf(env.session), message(call('bash')));

  env.fire('session/event', { type: 'assistant/message', data: { message: { content: [call('read')] } } });
  assert.deepEqual(env.stepOf(env.session), message(call('read')));

  env.fire('session/disposed', {});
  assert.equal(env.stepOf(env.session), undefined);
});

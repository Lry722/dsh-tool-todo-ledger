import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoverageBudget,
  inProgressTask,
  installReportGuard,
  installStepTracker,
  stepCoverage,
  stepToolCalls,
} from '../src/guard.js';
import {
  LEDGER_VERSION,
  emptyLedger,
  finishLedger,
  foldLedgerEvent,
  legacyTodos,
  startLedger,
  writeLedger,
} from '../src/ledger.js';

const call = (name, id = `${name}-call`) => ({ type: 'tool-call', id, name, arguments: '{}' });
const message = (...calls) => ({ content: calls });
const execution = (rootCallId, name = 'bash') => ({ rootCallId, name });

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
  assert.equal(stepCoverage(undefined, message(call('todo_report')), execution('todo_report-call')).outcome, 'exempt');
});

test('work requires an in-progress main task', () => {
  const step = message(call('todo_report'), call('bash'));
  assert.match(stepCoverage(emptyLedger(), step, execution('bash-call')).reason, /no main task is in progress/);
  assert.equal(stepCoverage(reportedLedger(), step, execution('bash-call')).outcome, 'covered');
});

test('coverage separates missing and failed reports from structural errors', () => {
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

  const late = message(call('bash'), call('todo_report'));
  assert.match(stepCoverage(reportedLedger(), late, execution('bash-call')).reason, /must precede/);
  assert.match(stepCoverage(reportedLedger(), late, execution('todo_report-call')).reason, /must precede/);

  const duplicated = message(call('todo_report'), call('todo_report', 'second-report'), call('bash'));
  assert.match(stepCoverage(reportedLedger(), duplicated, execution('bash-call')).reason, /exactly once/);
  assert.match(stepCoverage(reportedLedger(), duplicated, execution('todo_report-call')).reason, /exactly once/);
});

test('calls outside the tracked assistant step are exempt', () => {
  const unmatched = message(call('bash'));
  assert.equal(stepCoverage(reportedLedger(), unmatched, execution('read-call')).outcome, 'exempt');
  assert.equal(stepCoverage(reportedLedger(), undefined, execution('bash-call')).outcome, 'exempt');
});

test('nested PTC sub-calls are judged by their root model call', () => {
  const step = message(call('todo_report'), call('run_code'));
  assert.equal(stepCoverage(reportedLedger(), step, execution('run_code-call', 'bash')).outcome, 'covered');

  const missing = message(call('run_code'));
  assert.deepEqual(stepCoverage(reportedLedger(), missing, execution('run_code-call', 'bash')), {
    outcome: 'uncovered',
    coverage: 'missing',
  });
});

test('coverage budget grants 3, 2 then 1 exemptions before blocking', () => {
  const budget = createCoverageBudget();
  const admissions = Array.from({ length: 7 }, () => budget.admit());
  assert.deepEqual(admissions.map((admission) => admission.allowed), [
    true, true, true, true, true, true, false,
  ]);
  assert.match(admissions[0].warning, /3 exempt steps/);
  assert.match(admissions[3].warning, /2 exempt steps/);
  assert.match(admissions[5].warning, /1 exempt step/);
  assert.equal(admissions[6].warning, undefined);
});

test('a recorded report resets the exemption budget', () => {
  const budget = createCoverageBudget();
  budget.admit();
  budget.admit();
  budget.reset();
  assert.match(budget.admit().warning, /3 exempt steps/);
});

function guardHarness(initialState = reportedLedger()) {
  let state = initialState;
  let step;
  let guard;
  const warnings = [];
  const ctx = {
    on() {},
    sessionProjections: {
      stateOf() {
        return state;
      },
    },
  };
  const agent = {
    session: { id: 'session-1' },
    steer(input) {
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
  installReportGuard(ctx, agent, () => step);
  return {
    warnings,
    setState(next) {
      state = next;
    },
    setStep(next) {
      step = next;
    },
    run(rootCallId = 'bash-call', name = 'bash') {
      return guard({ agent, rootCallId, name });
    },
  };
}

test('missing reports are exempted with one steer per warning round', () => {
  const h = guardHarness();

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0].content[0].text, /3 exempt steps/);

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
  assert.match(h.warnings[1].content[0].text, /2 exempt steps/);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 2);

  h.setStep(message(call('bash')));
  assert.equal(h.run(), undefined);
  assert.equal(h.warnings.length, 3);
  assert.match(h.warnings[2].content[0].text, /1 exempt step/);

  h.setStep(message(call('bash')));
  assert.match(h.run(), /coverage budget is exhausted/);
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
  assert.match(h.run(), /coverage budget is exhausted/);
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
  assert.match(h.warnings[1].content[0].text, /3 exempt steps/);
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
  assert.match(h.warnings[1].content[0].text, /3 exempt steps/);
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
  assert.match(h.warnings[1].content[0].text, /3 exempt steps/);
});

test('plan gaps and malformed steps remain hard blocks', () => {
  const h = guardHarness();
  h.setState(emptyLedger());
  h.setStep(message(call('todo_report'), call('bash')));
  assert.match(h.run(), /no main task is in progress/);

  h.setState(reportedLedger());
  h.setStep(message(call('bash'), call('todo_report')));
  assert.match(h.run(), /must precede/);
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

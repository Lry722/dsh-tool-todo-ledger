import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inProgressTask,
  installReportGuard,
  installStepTracker,
  stepToolCalls,
  stepViolation,
} from '../src/guard.js';
import {
  LEDGER_VERSION,
  emptyLedger,
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

test('todo-only steps need no report and remain allowed', () => {
  assert.equal(stepViolation(undefined, message(call('todo_write'), call('todo_read')), execution('todo_write-call')), undefined);
  assert.equal(stepViolation(undefined, message(call('todo_report')), execution('todo_report-call')), undefined);
});

test('work requires an in-progress main task', () => {
  const step = message(call('todo_report'), call('bash'));
  assert.match(stepViolation(emptyLedger(), step, execution('bash-call')), /no main task is in progress/);
  assert.equal(stepViolation(reportedLedger(), step, execution('bash-call')), undefined);
});

test('work requires one todo_report before the other tool calls', () => {
  const missing = message(call('bash'));
  assert.match(stepViolation(reportedLedger(), missing, execution('bash-call')), /without todo_report/);

  const late = message(call('bash'), call('todo_report'));
  assert.match(stepViolation(reportedLedger(), late, execution('bash-call')), /must precede/);
  assert.match(stepViolation(reportedLedger(), late, execution('todo_report-call')), /must precede/);

  const duplicated = message(call('todo_report'), call('todo_report', 'second-report'), call('bash'));
  assert.match(stepViolation(reportedLedger(), duplicated, execution('bash-call')), /exactly once/);
  assert.match(stepViolation(reportedLedger(), duplicated, execution('todo_report-call')), /exactly once/);
});

test('work waits for the step report to be recorded', () => {
  const step = message(call('todo_report'), call('bash'));
  assert.match(stepViolation(inProgressLedger(), step, execution('bash-call')), /did not record a report/);
  assert.equal(stepViolation(reportedLedger('todo_report-call'), step, execution('bash-call')), undefined);
  assert.match(stepViolation(reportedLedger('other-report'), step, execution('bash-call')), /did not record a report/);
});

test('nested PTC sub-calls are judged by their root model call', () => {
  const step = message(call('todo_report'), call('run_code'));
  assert.equal(stepViolation(reportedLedger(), step, execution('run_code-call', 'bash')), undefined);

  const uncovered = message(call('run_code'), call('todo_report'));
  assert.match(stepViolation(reportedLedger(), uncovered, execution('run_code-call', 'bash')), /must precede/);
});

test('an unmatched step cannot authorize work', () => {
  const step = message(call('bash'));
  assert.match(stepViolation(reportedLedger(), step, execution('read-call')), /could not be matched/);
  assert.match(stepViolation(reportedLedger(), undefined, execution('bash-call')), /could not be matched/);
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

test('a guard denies and allows through the live projection and tracked step', () => {
  const listeners = new Map();
  const session = { id: 'session-1' };
  let state = reportedLedger();
  let guard;
  const ctx = {
    on(type, fn) {
      listeners.set(type, fn);
    },
    sessionProjections: {
      stateOf() {
        return state;
      },
    },
  };
  const agent = {
    session,
    ctx: {
      tools: {
        guard(fn) {
          guard = fn;
          return () => {};
        },
      },
    },
  };
  const stepOf = installStepTracker(ctx);
  installReportGuard(ctx, agent, stepOf);
  listeners.get('session/event')(session, assistantEvent(call('todo_report'), call('bash')));
  assert.equal(guard({ agent, rootCallId: 'bash-call', name: 'bash' }), undefined);

  state = emptyLedger();
  assert.match(guard({ agent, rootCallId: 'bash-call', name: 'bash' }), /no main task is in progress/);
  assert.equal(guard({ rootCallId: 'bash-call', name: 'bash' }), undefined);
});

test('a projection failure fails closed', () => {
  let guard;
  const ctx = {
    on() {},
    sessionProjections: {
      stateOf() {
        throw new Error('projection unavailable');
      },
    },
  };
  const agent = {
    session: { id: 'session-1' },
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
  assert.match(guard({ agent: agent.session, rootCallId: 'bash-call', name: 'bash' }), /could not be verified/);
});

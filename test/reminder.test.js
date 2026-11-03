import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inProgressTaskIndex,
  installReportReminder,
  missingReportTools,
  reportReminder,
} from '../src/reminder.js';

const call = (name) => ({ type: 'tool-call', id: `${name}-call`, name, arguments: '{}' });
const message = (...names) => ({ content: names.map(call) });
const ledger = (...statuses) => ({
  currentIds: statuses.map((_, index) => `t${index + 1}`),
  nodes: statuses.map((status, index) => ({ id: `t${index + 1}`, status })),
});

function harness({ state, agent = true } = {}) {
  let listener;
  const injected = [];
  const session = { id: 'session-1' };
  const target = { inject: (notice) => injected.push(notice) };
  installReportReminder({
    on(_type, fn) { listener = fn; },
    agents: { get: () => (agent ? target : undefined) },
    sessionProjections: { stateOf: () => state },
  });
  return { session, injected, fire: (event) => listener(session, event) };
}

function assistantEvent(content, extra = {}) {
  return { type: 'assistant/message', data: { message: { content }, ...extra } };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('missing report detection ignores exempt tool calls and reported steps', () => {
  assert.deepEqual(missingReportTools(message('bash', 'read')), ['bash', 'read']);
  assert.deepEqual(missingReportTools(message('bash', 'bash')), ['bash']);
  assert.equal(missingReportTools(message('todo_write', 'todo_read')), null);
  assert.equal(missingReportTools(message('bash', 'todo_report')), null);
  assert.equal(missingReportTools(message()), null);
});

test('reminder names the in-progress task and offending tools', () => {
  assert.equal(inProgressTaskIndex(ledger('completed', 'in_progress', 'pending')), 2);
  assert.equal(inProgressTaskIndex(ledger('completed')), 0);
  assert.equal(inProgressTaskIndex(undefined), 0);
  const notice = reportReminder(['bash', 'read'], 2);
  assert.equal(notice.source.kind, 'todo-ledger-reminder');
  assert.equal(notice.source.form, 'notice');
  assert.match(notice.content[0].text, /`bash`, `read`/);
  assert.match(notice.content[0].text, /Main task 2 is in progress/);
});

test('a violating step queues one notice after the append transaction', async () => {
  const env = harness({ state: ledger('completed', 'in_progress') });
  env.fire(assistantEvent([call('bash')]));
  assert.equal(env.injected.length, 0);
  await flush();
  assert.equal(env.injected.length, 1);
  assert.match(env.injected[0].content[0].text, /without todo_report/);

  env.fire({ type: 'user/message', data: {} });
  env.fire(assistantEvent([call('bash'), call('todo_report')]));
  env.fire(assistantEvent([]));
  await flush();
  assert.equal(env.injected.length, 1);
});

test('reminders require an in-progress task, a live agent and a completed step', async () => {
  const states = [undefined, ledger('completed'), ledger('pending')];
  for (const state of states) {
    const env = harness({ state });
    env.fire(assistantEvent([call('bash')]));
    await flush();
    assert.equal(env.injected.length, 0);
  }
  const interrupted = harness({ state: ledger('in_progress') });
  interrupted.fire(assistantEvent([call('bash')], { interrupted: true }));
  await flush();
  assert.equal(interrupted.injected.length, 0);
  const detached = harness({ state: ledger('in_progress'), agent: false });
  detached.fire(assistantEvent([call('bash')]));
  await flush();
  assert.equal(detached.injected.length, 0);
});

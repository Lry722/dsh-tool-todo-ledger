import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createLedgerTools, scheduleExportCleanup } from '../src/tools.js';
import {
  LEDGER_VERSION,
  emptyLedger,
  finishLedger,
  foldLedgerEvent,
  legacyTodos,
  startLedger,
  writeLedger,
} from '../src/ledger.js';
import { LEDGER_MESSAGES, fillPrompt } from '../src/prompts.js';
import { HISTORY_PROJECTION_KEY, emptyHistory, recordHistoryEvent } from '../src/history.js';

function ledgerMessage(key, values) {
  return (error) => error.message === fillPrompt(LEDGER_MESSAGES[key], values);
}

function harness({ signal, stateAvailable = true, step } = {}) {
  let state = emptyLedger();
  let history = emptyHistory();
  let currentStep = step;
  let seq = 0;
  const appended = [];
  const recordEvent = (event) => {
    appended.push(event);
    state = foldLedgerEvent(state, event);
    history = recordHistoryEvent(history, event);
  };
  const execSignal = signal ?? new AbortController().signal;
  const ctx = {
    sessionProjections: {
      stateOf(_session, key) {
        if (key === HISTORY_PROJECTION_KEY) return history;
        return stateAvailable ? state : undefined;
      },
    },
  };
  const agent = {
    session: {
      id: 'session-1',
      append(type, data) {
        recordEvent({ type, data, seq: ++seq, time: seq * 100 });
      },
    },
  };
  const tools = Object.fromEntries(
    createLedgerTools(ctx, () => currentStep).map((tool) => [tool.name, tool]),
  );
  return {
    tools,
    agent,
    appended,
    state: () => state,
    // Mirror the agent loop: every model-requested call logs tool/call before
    // its tool body appends ledger operations.
    beginCall(callId, turn = 1, step = 1) {
      recordEvent({ type: 'tool/call', data: { callId, turn, step }, seq: ++seq, time: seq * 100 });
    },
    exec: { agent, callId: 'call-1', signal: execSignal },
  };
}

// Minimal replica of the pre-refactor updateLedger + appendOperation path.
// The public entry points keep their clone-per-call semantics, so this yields
// the exact event payloads HEAD emitted for the same argument sequence.
function legacyCompositeEvents(state, args, callId) {
  let next = state;
  const events = [];
  if (args.finish !== undefined) {
    const finished = finishLedger(next, args.finish);
    next = finished.state;
    events.push({
      todos: legacyTodos(next),
      ledger: { version: LEDGER_VERSION, operation: 'finish', taskId: finished.taskId },
    });
  }
  if (args.todos !== undefined || args.reorderFrom !== undefined) {
    const write = writeLedger(next, args.todos ?? [], args.reorderFrom);
    next = write.state;
    events.push({
      todos: legacyTodos(next),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'write',
        mode: write.mode,
        ...(write.reorderFrom === undefined ? {} : { reorderFrom: write.reorderFrom }),
        added: write.added.map(({ id, content }) => ({ id, content })),
        invalidatedIds: write.invalidated.map((task) => task.id),
      },
    });
  }
  if (!next.currentIds.some((id) => next.nodes.find((node) => node.id === id)?.status === 'in_progress')) {
    const index = next.currentIds.findIndex((id) => next.nodes.find((node) => node.id === id)?.status === 'pending') + 1;
    if (index > 0) {
      const started = startLedger(next, index);
      next = started.state;
      events.push({
        todos: legacyTodos(next),
        ledger: { version: LEDGER_VERSION, operation: 'start', taskId: started.taskId, callId: String(callId) },
      });
    }
  }
  return { state: next, events };
}

test('todo_write appends a replayable delta', async () => {
  const env = harness();
  assert.deepEqual(Object.keys(env.tools), ['todo_write', 'todo_read', 'todo_report']);
  const first = await env.tools.todo_write.execute({ todos: ['First'] }, env.exec);
  assert.deepEqual(first.added, [{ index: 1, content: 'First' }]);
  assert.deepEqual(first.started, { content: 'First' });
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start']);
  assert.deepEqual(env.appended[0].data.todos, [{ content: 'First', status: 'pending' }]);
  assert.deepEqual(env.appended[1].data.todos, [{ content: 'First', status: 'in_progress' }]);

  const second = await env.tools.todo_write.execute({ todos: ['Second'] }, env.exec);
  assert.equal(second.started, undefined);
  assert.equal(env.appended.length, 3);
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks.map((task) => task.content), ['First', 'Second']);
});

test('todo_read full exports a complete private history file', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['First'] }, env.exec);
  const result = await env.tools.todo_read.execute({ full: true }, env.exec);
  const directory = dirname(result.path);
  try {
    assert.equal(dirname(directory), tmpdir());
    assert.match(basename(directory), /^todo-ledger-/);
    assert.match(basename(result.path), /^todo-ledger-session-1-\d+\.json$/);
    const document = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(document.format, 'dsh-todo-ledger-history/v2');
    assert.equal(document.sessionId, 'session-1');
    assert.equal(typeof document.exportedAt, 'string');
    assert.equal(Number.isNaN(Date.parse(document.exportedAt)), false);
    assert.deepEqual(document.state.currentIds, env.state().currentIds);
    assert.equal(result.eventCount, env.appended.length);
    assert.ok(env.appended.every((event) => event.type === 'todo/write'));
    // The export keeps the semantic operations only; the repeated `todos`
    // snapshot stays in the session log for the official todo projection.
    assert.deepEqual(
      document.events,
      env.appended.map(({ seq, time, data }) => ({ seq, time, ledger: data.ledger })),
    );
    if (process.platform !== 'win32') {
      assert.equal((await stat(result.path)).mode & 0o777, 0o600);
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('todo_read full creates no export when the projection is unavailable', async () => {
  const prefix = 'todo-ledger-';
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith(prefix)));
  const env = harness({ stateAvailable: false });
  await assert.rejects(
    env.tools.todo_read.execute({ full: true }, env.exec),
    (error) => error.message === 'todo_read: todoLedger projection is unavailable',
  );
  const created = (await readdir(tmpdir()))
    .filter((name) => name.startsWith(prefix) && !before.has(name));
  assert.deepEqual(created, []);
});

test('initial creation auto-starts a task that can be reported', async () => {
  const env = harness();
  const created = await env.tools.todo_write.execute({ todos: ['Task'] }, env.exec);
  assert.deepEqual(created.started, { content: 'Task' });
  const reported = await env.tools.todo_report.execute({ index: 1, inIssue: false }, env.exec);
  assert.deepEqual(reported, {});
});

test('a report that runs after its finish in the same step is recorded', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['One', 'Two'] }, env.exec);

  // Finish first, then report the finished task: both calls still share one
  // assistant step, so the late report closes out that task instead of failing.
  env.beginCall('finish-call', 2, 1);
  const finished = await env.tools.todo_write.execute(
    { finish: 1 },
    { ...env.exec, callId: 'finish-call' },
  );
  assert.deepEqual(finished.finished, { content: 'One' });
  assert.deepEqual(finished.started, { content: 'Two' });

  env.beginCall('report-call', 2, 1);
  const reported = await env.tools.todo_report.execute(
    { index: 1, inIssue: false },
    { ...env.exec, callId: 'report-call' },
  );
  assert.deepEqual(reported, {});
  assert.equal(env.state().nodes[0].reports.length, 1);
  assert.equal(env.state().nodes[0].reports.at(-1).callId, 'report-call');
});

test('a report for a task appended later in the same step is deferred', async () => {
  const step = {
    content: [
      { type: 'tool-call', id: 'report-call', name: 'todo_report', arguments: '{"index":1,"inIssue":false}' },
      { type: 'tool-call', id: 'write-call', name: 'todo_write', arguments: '{"todos":["First"]}' },
    ],
  };
  const env = harness({ step });

  // The task does not exist yet, but the later write creates and starts it, so
  // the report is accepted instead of failing the index range check.
  env.beginCall('report-call', 2, 1);
  const reported = await env.tools.todo_report.execute(
    { index: 1, inIssue: false },
    { ...env.exec, callId: 'report-call' },
  );
  assert.deepEqual(reported, { deferred: true });
  assert.deepEqual(env.state().currentIds, []);

  env.beginCall('write-call', 2, 1);
  const written = await env.tools.todo_write.execute(
    { todos: ['First'] },
    { ...env.exec, callId: 'write-call' },
  );
  assert.deepEqual(written.added, [{ index: 1, content: 'First' }]);
  assert.deepEqual(written.started, { content: 'First' });
  assert.equal(env.state().nodes[0].reports.length, 1);
  assert.equal(env.state().nodes[0].reports.at(-1).callId, 'report-call');
  assert.deepEqual(
    env.appended
      .filter((event) => event.type === 'todo/write')
      .map((event) => event.data.ledger.operation),
    ['write', 'start', 'report'],
  );
});

test('a deferred report still rejects a task that stays pending', async () => {
  const step = {
    content: [
      { type: 'tool-call', id: 'report-call', name: 'todo_report', arguments: '{"index":2,"inIssue":false}' },
      { type: 'tool-call', id: 'write-call', name: 'todo_write', arguments: '{"todos":["Later"]}' },
    ],
  };
  const env = harness({ step });
  await env.tools.todo_write.execute({ todos: ['Active'] }, env.exec);

  env.beginCall('report-call', 2, 1);
  await assert.rejects(
    env.tools.todo_report.execute(
      { index: 2, inIssue: false },
      { ...env.exec, callId: 'report-call' },
    ),
    ledgerMessage('reportInactiveTask', { index: 2, status: 'pending', active: '1「Active」' }),
  );
});

test('a deferred report waits for a later write to activate the task', async () => {
  const step = {
    content: [
      { type: 'tool-call', id: 'report-call', name: 'todo_report', arguments: '{"index":2,"inIssue":false}' },
      { type: 'tool-call', id: 'append-call', name: 'todo_write', arguments: '{"todos":["Later"]}' },
      { type: 'tool-call', id: 'finish-call', name: 'todo_write', arguments: '{"finish":1}' },
    ],
  };
  const env = harness({ step });
  await env.tools.todo_write.execute({ todos: ['Active'] }, env.exec);

  // The target is still pending after the append; the finish in the same step
  // makes it active, so the report must wait for that second write.
  env.beginCall('report-call', 2, 1);
  const reported = await env.tools.todo_report.execute(
    { index: 2, inIssue: false },
    { ...env.exec, callId: 'report-call' },
  );
  assert.deepEqual(reported, { deferred: true });

  env.beginCall('append-call', 2, 1);
  await env.tools.todo_write.execute({ todos: ['Later'] }, { ...env.exec, callId: 'append-call' });
  assert.equal(env.state().nodes[1].reports.length, 0);

  env.beginCall('finish-call', 2, 1);
  await env.tools.todo_write.execute({ finish: 1 }, { ...env.exec, callId: 'finish-call' });
  assert.equal(env.state().nodes[1].reports.length, 1);
  assert.equal(env.state().nodes[1].reports.at(-1).callId, 'report-call');
});

test('an already-aborted call writes nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  const env = harness({ signal: controller.signal });
  const result = await env.tools.todo_write.execute({ todos: ['Ignored'] }, env.exec);
  assert.deepEqual(result, {});
  assert.equal(env.appended.length, 0);
  assert.deepEqual(env.state().currentIds, []);
});

test('an already-aborted report writes nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  const env = harness({ signal: controller.signal });
  await env.tools.todo_write.execute(
    { todos: ['Task'] },
    { ...env.exec, signal: new AbortController().signal },
  );
  const reported = await env.tools.todo_report.execute({ index: 1, inIssue: false }, env.exec);
  assert.deepEqual(reported, {});
  assert.equal(env.state().nodes[0].reports.length, 0);
});

test('composite writes preserve separate start, report and finish operations', async () => {
  const env = harness();
  const created = await env.tools.todo_write.execute({ todos: ['Task'] }, env.exec);
  assert.deepEqual(created.started, { content: 'Task' });
  const reported = await env.tools.todo_report.execute({ index: 1, inIssue: true, issue: 'Local' }, env.exec);
  const maintained = await env.tools.todo_report.execute({ index: 1, inIssue: true }, env.exec);
  const finished = await env.tools.todo_write.execute({ finish: 1 }, env.exec);
  assert.deepEqual(finished.finished, { content: 'Task' });
  assert.deepEqual(reported, {});
  assert.deepEqual(maintained, {});
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start', 'report', 'report', 'finish']);
  assert.equal(env.appended[2].data.ledger.report.inIssue, true);
  assert.equal(env.appended[2].data.ledger.report.issue, 'Local');
  assert.equal(env.appended[3].data.ledger.report.inIssue, true);
  assert.equal(env.appended[3].data.ledger.report.issue, 'Local');
  assert.equal(env.appended[1].data.ledger.callId, 'call-1');
  assert.equal(env.appended[2].data.ledger.callId, 'call-1');
  assert.equal(env.appended[3].data.ledger.callId, 'call-1');
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks, [{ index: 1, content: 'Task', status: 'completed' }]);
});

test('finish auto-starts the next task', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['One', 'Two'] }, env.exec);
  const result = await env.tools.todo_write.execute({ finish: 1 }, env.exec);
  assert.deepEqual(result, {
    finished: { content: 'One' },
    started: { content: 'Two' },
  });
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start', 'finish', 'start']);
  assert.deepEqual(env.appended[2].data.todos, [
    { content: 'One', status: 'completed' },
    { content: 'Two', status: 'pending' },
  ]);
  assert.deepEqual(env.appended[3].data.todos, [
    { content: 'One', status: 'completed' },
    { content: 'Two', status: 'in_progress' },
  ]);
});

test('reorder auto-starts the first pending task', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['One', 'Two', 'Three'] }, env.exec);
  await env.tools.todo_write.execute({ finish: 1 }, env.exec);
  const result = await env.tools.todo_write.execute({
    reorderFrom: 2,
    todos: ['Replacement', 'Later'],
  }, env.exec);
  assert.equal(result.mode, 'reorder');
  assert.deepEqual(result.invalidated, [
    { oldIndex: 2, content: 'Two', status: 'in_progress' },
    { oldIndex: 3, content: 'Three', status: 'pending' },
  ]);
  assert.deepEqual(result.started, { content: 'Replacement' });
  assert.deepEqual(result.tasks, [
    { index: 1, content: 'One', status: 'completed' },
    { index: 2, content: 'Replacement', status: 'in_progress' },
    { index: 3, content: 'Later', status: 'pending' },
  ]);
  assert.deepEqual(env.appended.at(-2).data.ledger.reorderFrom, 2);
  assert.equal(env.appended.at(-1).data.ledger.operation, 'start');
  assert.deepEqual(env.appended.at(-1).data.todos, [
    { content: 'One', status: 'completed' },
    { content: 'Replacement', status: 'in_progress' },
    { content: 'Later', status: 'pending' },
  ]);
});

test('reorder returns the default read view instead of the full plan', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['One', 'Two', 'Three', 'Four'] }, env.exec);
  await env.tools.todo_write.execute({ finish: 1 }, env.exec);
  await env.tools.todo_write.execute({ finish: 2 }, env.exec);
  const result = await env.tools.todo_write.execute({
    reorderFrom: 3,
    todos: ['Replacement'],
  }, env.exec);
  assert.equal(Object.hasOwn(result, 'plan'), false);
  assert.deepEqual(result.tasks, [
    { index: 2, content: 'Two', status: 'completed' },
    { index: 3, content: 'Replacement', status: 'in_progress' },
  ]);
});

test('composite event payloads match the head sequence byte for byte', async () => {
  const scenarios = [
    [{ todos: ['First', 'Second'] }],
    [{ todos: ['First', 'Second'] }, { finish: 1 }],
    [{ todos: ['First', 'Second'] }, { finish: 1, todos: ['Third'] }],
    [{ todos: ['First', 'Second', 'Third'] }, { finish: 1 }, { reorderFrom: 2, todos: ['Replacement', 'Later'] }],
    [{ todos: ['One', 'Two', 'Three', 'Four'] }, { finish: 1, reorderFrom: 3, todos: ['Replacement', 'Later'] }],
  ];

  for (const scenario of scenarios) {
    const env = harness();
    let expectedState = emptyLedger();
    const expectedEvents = [];
    for (const args of scenario) {
      const reference = legacyCompositeEvents(expectedState, args, env.exec.callId);
      expectedState = reference.state;
      expectedEvents.push(...reference.events);
      await env.tools.todo_write.execute(args, env.exec);
    }

    const actualEvents = env.appended.map((event) => event.data);
    assert.deepEqual(actualEvents, expectedEvents);
    assert.equal(
      JSON.stringify(actualEvents),
      JSON.stringify(expectedEvents),
      'todos and ledger payloads must be byte-identical to the head sequence',
    );
    assert.deepEqual(legacyTodos(env.state()), legacyTodos(expectedState));
    assert.deepEqual(env.state().currentIds, expectedState.currentIds);
  }
});

test('a failed composite call appends no partial operations', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['One', 'Two'] }, env.exec);
  const eventCount = env.appended.length;
  await assert.rejects(
    env.tools.todo_write.execute({ finish: 1, reorderFrom: 3 }, env.exec),
    ledgerMessage('reorderRange', { count: 2 }),
  );
  assert.equal(env.appended.length, eventCount);
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks, [
    { index: 1, content: 'One', status: 'in_progress' },
    { index: 2, content: 'Two', status: 'pending' },
  ]);
});
test('export directories are removed after their TTL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'todo-ledger-ttl-'));
  scheduleExportCleanup(directory, 20);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await assert.rejects(stat(directory), (error) => error.code === 'ENOENT');
});

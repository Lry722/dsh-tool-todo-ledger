import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerTools } from '../src/tools.js';
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

function ledgerMessage(key, values) {
  return (error) => error.message === fillPrompt(LEDGER_MESSAGES[key], values);
}

function harness({
  enabled = false,
  reviewText = '{"compliant":true}',
  instructions = [],
  signal,
  onStream,
  throwOnAbort = true,
  logger,
} = {}) {
  let state = emptyLedger();
  let seq = 0;
  let reviewCalls = 0;
  const appended = [];
  const execSignal = signal ?? new AbortController().signal;
  const events = new Map(instructions.map((text, index) => [index + 1, {
    type: 'user/message',
    data: { source: { kind: 'agent-instructions' }, content: [{ type: 'text', text }] },
  }]));
  const ctx = {
    sessionProjections: { stateOf: () => state },
    llm: {
      stream(params) {
        reviewCalls += 1;
        onStream?.(params);
        return (async function* () {
          if (throwOnAbort && params.signal?.aborted) throw new Error('review aborted');
          yield { type: 'text-delta', index: 0, text: reviewText };
          if (throwOnAbort && params.signal?.aborted) throw new Error('review aborted');
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    },
    ...(logger === undefined ? {} : { logger }),
  };
  const agent = {
    session: {
      surface: { nodes: [...events.keys()] },
      eventAt: (sequence) => events.get(sequence),
      requestHeader: () => ({ config: { provider: 'test', model: 'test' } }),
      append(type, data) {
        const event = { type, data, seq: ++seq, time: seq * 100 };
        appended.push(event);
        state = foldLedgerEvent(state, event);
      },
    },
  };
  let current = enabled;
  const config = { reviewEnabled: { get: () => current } };
  const tools = Object.fromEntries(createLedgerTools(ctx, config).map((tool) => [tool.name, tool]));
  return {
    tools,
    agent,
    appended,
    state: () => state,
    setEnabled(value) { current = value; },
    reviewCalls() { return reviewCalls; },
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

test('todo_write appends a replayable delta and volatile review config is read per call', async () => {
  const env = harness();
  assert.deepEqual(Object.keys(env.tools), ['todo_write', 'todo_read', 'todo_report']);
  const first = await env.tools.todo_write.execute({ todos: ['First'] }, env.exec);
  assert.equal(first.review, undefined);
  assert.deepEqual(first.added, [{ index: 1, content: 'First' }]);
  assert.deepEqual(first.started, { content: 'First' });
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start']);
  assert.deepEqual(env.appended[0].data.todos, [{ content: 'First', status: 'pending' }]);
  assert.deepEqual(env.appended[1].data.todos, [{ content: 'First', status: 'in_progress' }]);

  env.setEnabled(true);
  const second = await env.tools.todo_write.execute({ todos: ['Second'] }, env.exec);
  assert.equal(second.review.status, 'passed');
  assert.equal(second.started, undefined);
  assert.equal(env.appended.length, 3);
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks.map((task) => task.content), ['First', 'Second']);
});

test('initial creation auto-starts a task that can be reported', async () => {
  const env = harness();
  const created = await env.tools.todo_write.execute({ todos: ['Task'] }, env.exec);
  assert.deepEqual(created.started, { content: 'Task' });
  const reported = await env.tools.todo_report.execute({ index: 1, inIssue: false }, env.exec);
  assert.deepEqual(reported, {});
});

test('review warnings are returned while technical failures stay invisible', async () => {
  const warning = harness({
    enabled: true,
    instructions: ['Write tests before implementation.'],
    reviewText: '{"compliant":false,"message":"Add the required test task."}',
  });
  const warned = await warning.tools.todo_write.execute({ todos: ['Implement'] }, warning.exec);
  assert.equal(warned.review.status, 'warning');
  assert.equal(warned.review.message, 'AGENTS.md review warning: Add the required test task.');
  assert.equal(warning.appended.length, 2);

  const malformed = harness({ enabled: true, instructions: ['Plan.'], reviewText: 'bad json' });
  const continued = await malformed.tools.todo_write.execute({ todos: ['Implement'] }, malformed.exec);
  assert.equal(Object.hasOwn(continued, 'review'), false);
  assert.equal(malformed.appended.length, 2);
});

test('cancellation during review leaves the ledger untouched and logs nothing', async () => {
  const controller = new AbortController();
  const warnings = [];
  const env = harness({
    enabled: true,
    instructions: ['Plan before writing.'],
    signal: controller.signal,
    onStream: () => controller.abort(),
    logger: { warn: (text) => warnings.push(text) },
  });
  const result = await env.tools.todo_write.execute({ todos: ['Cancelled'] }, env.exec);
  assert.deepEqual(result, {});
  assert.equal(env.reviewCalls(), 1);
  assert.equal(env.appended.length, 0);
  assert.deepEqual(env.state().nodes, []);
  assert.deepEqual(env.state().currentIds, []);
  assert.equal(warnings.length, 0);

  // A review that finishes after the abort must also discard its pending writes.
  const completed = new AbortController();
  const late = harness({
    enabled: true,
    instructions: ['Plan before writing.'],
    signal: completed.signal,
    onStream: () => completed.abort(),
    throwOnAbort: false,
  });
  const lateResult = await late.tools.todo_write.execute({ todos: ['Cancelled'] }, late.exec);
  assert.deepEqual(lateResult, {});
  assert.equal(late.reviewCalls(), 1);
  assert.equal(late.appended.length, 0);
  assert.deepEqual(late.state().currentIds, []);
});

test('technical review failures still write and log a host warning', async () => {
  const warnings = [];
  const env = harness({
    enabled: true,
    instructions: ['Plan.'],
    reviewText: 'bad json',
    logger: { warn: (text) => warnings.push(text) },
  });
  const result = await env.tools.todo_write.execute({ todos: ['Implement'] }, env.exec);
  assert.equal(Object.hasOwn(result, 'review'), false);
  assert.deepEqual(result.added, [{ index: 1, content: 'Implement' }]);
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^todo-ledger: plan review skipped: /);
  assert.match(warnings[0], /json/i);
});

test('an already-aborted call writes nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  const env = harness({ enabled: true, instructions: ['Plan.'], signal: controller.signal });
  const result = await env.tools.todo_write.execute({ todos: ['Ignored'] }, env.exec);
  assert.deepEqual(result, {});
  assert.equal(env.reviewCalls(), 0);
  assert.equal(env.appended.length, 0);
  assert.deepEqual(env.state().currentIds, []);
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

test('finish auto-starts the next task without triggering plan review', async () => {
  const env = harness({ enabled: true, instructions: ['Plan carefully.'] });
  await env.tools.todo_write.execute({ todos: ['One', 'Two'] }, env.exec);
  assert.equal(env.reviewCalls(), 1);
  const result = await env.tools.todo_write.execute({ finish: 1 }, env.exec);
  assert.equal(env.reviewCalls(), 1);
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
  assert.deepEqual(result.plan, [
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
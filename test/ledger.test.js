import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_VERSION,
  currentView,
  dockTodos,
  emptyLedger,
  finishLedger,
  foldLedgerEvent,
  ledgerView,
  legacyTodos,
  numberedPlan,
  reportLedger,
  startLedger,
  updateLedger,
  writeLedger,
} from '../src/ledger.js';
import { LEDGER_MESSAGES, fillPrompt } from '../src/prompts.js';

function ledgerMessage(key, values) {
  return (error) => error.message === fillPrompt(LEDGER_MESSAGES[key], values);
}

function planned() {
  return writeLedger(emptyLedger(), ['Confirm requirements', 'Implement ledger', 'Add tests']).state;
}

function at(seq) {
  return { seq, time: seq * 100 };
}

function writeEvent(state, seq, todos, reorderFrom) {
  const result = writeLedger(state, todos, reorderFrom);
  return foldLedgerEvent(state, {
    type: 'todo/write',
    ...at(seq),
    data: {
      todos: legacyTodos(result.state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'write',
        mode: result.mode,
        ...(result.reorderFrom === undefined ? {} : { reorderFrom: result.reorderFrom }),
        added: result.added.map(({ id, content }) => ({ id, content })),
        invalidatedIds: result.invalidated.map((task) => task.id),
      },
    },
  });
}

function startEvent(state, seq, index, callId) {
  const result = startLedger(state, index);
  return foldLedgerEvent(state, {
    type: 'todo/write',
    ...at(seq),
    data: {
      todos: legacyTodos(result.state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'start',
        taskId: result.taskId,
        ...(callId === undefined ? {} : { callId }),
      },
    },
  });
}

function finishEvent(state, seq, index) {
  const result = finishLedger(state, index);
  return foldLedgerEvent(state, {
    type: 'todo/write',
    ...at(seq),
    data: {
      todos: legacyTodos(result.state),
      ledger: { version: LEDGER_VERSION, operation: 'finish', taskId: result.taskId },
    },
  });
}

function reportEvent(state, seq, index, inIssue, issue, callId) {
  const result = reportLedger(state, index, inIssue, issue);
  return foldLedgerEvent(state, {
    type: 'todo/write',
    ...at(seq),
    data: {
      todos: legacyTodos(result.state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'report',
        taskId: result.taskId,
        ...(callId === undefined ? {} : { callId }),
        report: result.report,
      },
    },
  });
}

function turnEvent(state, seq, type, turn) {
  return foldLedgerEvent(state, {
    type,
    ...at(seq),
    data: type === 'turn/start' ? { turn } : { turn, reason: { kind: 'stop' } },
  });
}

function toolCallEvent(state, seq, callId, turn, step) {
  return foldLedgerEvent(state, {
    type: 'tool/call',
    ...at(seq),
    data: {
      callId,
      ...(turn === undefined ? {} : { turn }),
      ...(step === undefined ? {} : { step }),
    },
  });
}

test('append assigns stable ids and current indices', () => {
  const result = writeLedger(emptyLedger(), ['First', 'Second']);
  assert.deepEqual(result.added, [
    { index: 1, id: 't1', content: 'First' },
    { index: 2, id: 't2', content: 'Second' },
  ]);
  assert.deepEqual(legacyTodos(result.state), [
    { content: 'First', status: 'pending' },
    { content: 'Second', status: 'pending' },
  ]);
});

test('tasks must start in order and finish explicitly', () => {
  const state = planned();
  assert.throws(() => startLedger(state, 2), ledgerMessage('startBlocked', { previous: 1, index: 2 }));
  const started = startLedger(state, 1).state;
  assert.throws(() => startLedger(started, 1), ledgerMessage('startNotPending', { index: 1, status: 'in_progress' }));
  assert.throws(() => finishLedger(started, 2), ledgerMessage('finishNotActive', { index: 2, status: 'pending' }));
  const finished = finishLedger(started, 1).state;
  assert.equal(startLedger(finished, 2).state.nodes[1].status, 'in_progress');
});

test('initial append auto-starts the first task', () => {
  const result = updateLedger(emptyLedger(), { todos: ['First', 'Second'] });

  assert.deepEqual(result.operations.map((operation) => operation.ledger.operation), ['write', 'start']);
  assert.deepEqual(result.started, { index: 1, taskId: 't1', status: 'in_progress' });
  assert.deepEqual(numberedPlan(result.state), [
    { index: 1, content: 'First', status: 'in_progress' },
    { index: 2, content: 'Second', status: 'pending' },
  ]);
});

test('finish auto-starts the next pending task', () => {
  const state = startLedger(planned(), 1).state;
  const result = updateLedger(state, { finish: 1 });

  assert.deepEqual(result.operations.map((operation) => operation.ledger.operation), ['finish', 'start']);
  assert.deepEqual(result.started, { index: 2, taskId: 't2', status: 'in_progress' });
  assert.deepEqual(numberedPlan(result.state), [
    { index: 1, content: 'Confirm requirements', status: 'completed' },
    { index: 2, content: 'Implement ledger', status: 'in_progress' },
    { index: 3, content: 'Add tests', status: 'pending' },
  ]);
});

test('a report after the finish in the same step records the finished task', () => {
  let state = startEvent(planned(), 1, 1);
  state = toolCallEvent(state, 2, 'finish-call', 4, 2);
  state = finishEvent(state, 3, 1);
  state = startEvent(state, 4, 2, 'finish-call');

  // PTC sub-calls share the outer run_code tool call, so the report sees the
  // same step without any new tool/call event of its own.
  const sameProgram = reportLedger(state, 1, false);
  assert.equal(sameProgram.state.nodes[0].reports.length, 1);
  assert.equal(sameProgram.state.lastReportTaskId, 't1');
  assert.deepEqual(currentView(sameProgram.state).tasks[0], {
    index: 1,
    content: 'Confirm requirements',
    status: 'completed',
  });

  // Native call order logs one tool/call per call, still inside the same step.
  const native = reportLedger(toolCallEvent(state, 5, 'report-call', 4, 2), 1, false);
  assert.equal(native.state.nodes[0].reports.length, 1);

  // From a later step a completed task is no longer an accepted target.
  const later = toolCallEvent(native.state, 6, 'later-call', 4, 3);
  assert.throws(
    () => reportLedger(later, 1, false),
    ledgerMessage('reportInactiveTask', {
      index: 1,
      status: 'completed',
      active: '2「Implement ledger」',
    }),
  );
});

test('a late report can continue the issue recorded before the finish', () => {
  let state = startEvent(planned(), 1, 1);
  state = reportEvent(state, 2, 1, true, 'Inspect official API', 'issue-call');
  state = toolCallEvent(state, 3, 'finish-call', 4, 2);
  state = finishEvent(state, 4, 1);
  state = startEvent(state, 5, 2, 'finish-call');
  // A report for the new active task moves the latest-report target away from
  // the finished task. Continuation still resolves from that task's own report.
  state = reportEvent(state, 6, 2, false, undefined, 'next-report');

  const late = reportLedger(toolCallEvent(state, 7, 'report-call', 4, 2), 1, true);
  assert.equal(late.state.nodes[0].reports.at(-1).issue, 'Inspect official API');
});

test('a tool call without step metadata clears the previous step', () => {
  let state = startEvent(planned(), 1, 1);
  state = toolCallEvent(state, 2, 'finish-call', 4, 2);
  state = toolCallEvent(state, 3, 'anonymous-call');

  // A finish after the anonymous call must not inherit the older step and look
  // like it belongs to a report that was already executed.
  assert.equal(state.lastToolCallTurn, undefined);
  assert.equal(state.lastToolCallStep, undefined);
  state = finishEvent(state, 4, 1);
  assert.equal(state.nodes[0].finishTurn, undefined);
  assert.equal(state.nodes[0].finishStep, undefined);
});

test('composite updates finish and reorder in a fixed order', () => {
  let state = writeLedger(emptyLedger(), ['Confirm', 'Implement', 'Test', 'Document']).state;
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  state = startLedger(state, 2).state;
  const result = updateLedger(state, {
    finish: 2,
    reorderFrom: 3,
    todos: ['Test replacement', 'Write documentation'],
  });

  assert.deepEqual(result.operations.map((operation) => operation.ledger.operation), ['finish', 'write', 'start']);
  assert.deepEqual(numberedPlan(result.state), [
    { index: 1, content: 'Confirm', status: 'completed' },
    { index: 2, content: 'Implement', status: 'completed' },
    { index: 3, content: 'Test replacement', status: 'in_progress' },
    { index: 4, content: 'Write documentation', status: 'pending' },
  ]);
  assert.deepEqual(result.state.nodes.slice(2, 4).map((node) => node.status), ['void', 'void']);
});

test('composite updates validate fully and leave the input state untouched', () => {
  const state = startLedger(planned(), 1).state;
  const before = structuredClone(state);
  assert.throws(
    () => updateLedger(state, { finish: 4 }),
    ledgerMessage('taskIndexRange', { tool: 'todo_write', count: 3 }),
  );
  assert.throws(() => updateLedger(state, {}), ledgerMessage('operationRequired'));
  assert.deepEqual(state, before);

  const removed = updateLedger(state, { reorderFrom: 2 });
  assert.deepEqual(numberedPlan(removed.state), [
    { index: 1, content: 'Confirm requirements', status: 'in_progress' },
  ]);
});

test('composite operations publish only intermediate legacy snapshots', () => {
  let state = writeLedger(emptyLedger(), ['Confirm', 'Implement', 'Test', 'Document']).state;
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  state = startLedger(state, 2).state;
  const before = structuredClone(state);
  const result = updateLedger(state, {
    finish: 2,
    reorderFrom: 3,
    todos: ['Test replacement', 'Write documentation'],
  });

  const finishedStep = finishLedger(before, 2);
  const writeStep = writeLedger(finishedStep.state, ['Test replacement', 'Write documentation'], 3);
  const startedStep = startLedger(writeStep.state, 3);

  assert.deepEqual(result.operations, [
    { todos: legacyTodos(finishedStep.state), ledger: { operation: 'finish', taskId: 't2' } },
    {
      todos: legacyTodos(writeStep.state),
      ledger: {
        operation: 'write',
        mode: writeStep.mode,
        reorderFrom: writeStep.reorderFrom,
        added: writeStep.added.map(({ id, content }) => ({ id, content })),
        invalidatedIds: writeStep.invalidated.map((task) => task.id),
      },
    },
    { todos: legacyTodos(startedStep.state), ledger: { operation: 'start', taskId: startedStep.taskId } },
  ]);
  for (const operation of result.operations) {
    assert.equal(Object.hasOwn(operation, 'state'), false, 'operations must drop intermediate states');
  }
  assert.equal(Object.hasOwn(result.write, 'state'), false, 'the write result must drop its intermediate state');
  assert.deepEqual(legacyTodos(result.state), legacyTodos(startedStep.state));
  assert.deepEqual(numberedPlan(result.state), numberedPlan(startedStep.state));
  assert.deepEqual(state, before, 'a successful composite update must leave its input untouched');
});

test('a failed composite update with a valid finish leaves the input state untouched', () => {
  const state = startLedger(planned(), 1).state;
  const before = structuredClone(state);
  assert.throws(
    () => updateLedger(state, { finish: 1, reorderFrom: 4 }),
    ledgerMessage('reorderRange', { count: 3 }),
  );
  assert.deepEqual(state, before, 'a failed composite must confine its successful finish to the working copy');
  assert.equal(state.nodes[0].status, 'in_progress');
  // Task numbers derive from the nodes, so a discarded write cannot shift them.
  assert.deepEqual(writeLedger(state, ['Next']).added, [{ index: 4, id: 't4', content: 'Next' }]);
});

test('reports validate issues and expose only the active issue', () => {
  const started = startLedger(planned(), 1).state;
  assert.throws(() => reportLedger(started, 1, true), ledgerMessage('issueRequired'));
  assert.throws(() => reportLedger(started, 1, false, 'Nested'), ledgerMessage('issueOmitted'));
  const reported = reportLedger(started, 1, true, 'Inspect official API').state;
  assert.deepEqual(currentView(reported).tasks[0], {
    index: 1,
    content: 'Confirm requirements',
    status: 'in_progress',
    issue: 'Inspect official API',
  });
  const maintained = reportLedger(reported, 1, true).state;
  assert.equal(currentView(maintained).tasks[0].issue, 'Inspect official API');
  assert.equal(maintained.nodes[0].reports.at(-1).issue, 'Inspect official API');
  const topLevel = reportLedger(maintained, 1, false).state;
  assert.equal(currentView(topLevel).tasks[0].issue, undefined);
  assert.throws(() => reportLedger(topLevel, 1, true), ledgerMessage('issueRequired'));
});

test('a blocked report names the in-progress task', () => {
  const started = startLedger(planned(), 1).state;
  assert.throws(
    () => reportLedger(started, 2, false),
    ledgerMessage('reportInactiveTask', {
      index: 2,
      status: 'pending',
      active: '1「Confirm requirements」',
    }),
  );
  assert.throws(
    () => reportLedger(planned(), 1, false),
    ledgerMessage('reportNoActiveTask', { index: 1, status: 'pending' }),
  );

  // A legacy snapshot can hold two in-progress tasks. Switching the report
  // target names the one left unfinished.
  const conflicting = reportLedger(started, 1, false).state;
  conflicting.nodes[1].status = 'in_progress';
  assert.throws(
    () => reportLedger(conflicting, 2, false),
    ledgerMessage('reportSwitchBlocked', { active: '1「Confirm requirements」' }),
  );
});

test('reorder voids unfinished suffix, preserves completion and renumbers replacements', () => {
  let state = planned();
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  state = startLedger(state, 2).state;
  state = reportLedger(state, 2, true, 'Query API').state;
  const result = writeLedger(state, ['Query DSH API', 'Continue ledger', 'Add tests', 'Update docs'], 2);

  assert.deepEqual(result.invalidated.map((task) => [task.oldIndex, task.content, task.status]), [
    [2, 'Implement ledger', 'in_progress'],
    [3, 'Add tests', 'pending'],
  ]);
  assert.deepEqual(numberedPlan(result.state), [
    { index: 1, content: 'Confirm requirements', status: 'completed' },
    { index: 2, content: 'Query DSH API', status: 'pending' },
    { index: 3, content: 'Continue ledger', status: 'pending' },
    { index: 4, content: 'Add tests', status: 'pending' },
    { index: 5, content: 'Update docs', status: 'pending' },
  ]);
  assert.deepEqual(result.state.nodes.slice(1, 3).map((node) => node.status), ['void', 'void']);
  assert.equal(result.state.nodes[1].reports[0].issue, 'Query API');
  assert.equal(result.state.lastReportTaskId, null);
});

test('an empty reorder explicitly voids unfinished work', () => {
  const result = writeLedger(planned(), [], 2);
  assert.deepEqual(numberedPlan(result.state), [
    { index: 1, content: 'Confirm requirements', status: 'pending' },
  ]);
  assert.equal(result.state.nodes.filter((node) => node.status === 'void').length, 2);
});

test('reorder auto-starts the first pending task when none is active', () => {
  let state = planned();
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  const result = updateLedger(state, {
    reorderFrom: 2,
    todos: ['Replacement', 'Later'],
  });

  assert.deepEqual(result.operations.map((operation) => operation.ledger.operation), ['write', 'start']);
  assert.deepEqual(result.started, { index: 2, taskId: 't4', status: 'in_progress' });
  assert.deepEqual(numberedPlan(result.state), [
    { index: 1, content: 'Confirm requirements', status: 'completed' },
    { index: 2, content: 'Replacement', status: 'in_progress' },
    { index: 3, content: 'Later', status: 'pending' },
  ]);
});

test('reorder keeps an existing in-progress task without auto-starting another', () => {
  const state = startLedger(planned(), 1).state;
  const result = updateLedger(state, {
    reorderFrom: 2,
    todos: ['Replacement'],
  });

  assert.deepEqual(result.operations.map((operation) => operation.ledger.operation), ['write']);
  assert.equal(result.started, undefined);
  assert.deepEqual(numberedPlan(result.state), [
    { index: 1, content: 'Confirm requirements', status: 'in_progress' },
    { index: 2, content: 'Replacement', status: 'pending' },
  ]);
});

test('default view starts at the last completed task', () => {
  let state = planned();
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  state = startLedger(state, 2).state;
  state = finishLedger(state, 2).state;
  assert.deepEqual(currentView(state), {
    tasks: [{ index: 2, content: 'Implement ledger', status: 'completed' }, { index: 3, content: 'Add tests', status: 'pending' }],
  });
});

test('the default view keeps unfinished legacy work before a completed task', () => {
  const legacy = foldLedgerEvent(emptyLedger(), {
    type: 'todo/write', seq: 1, time: 100,
    data: { todos: [{ content: 'A', status: 'pending' }, { content: 'B', status: 'completed' }] },
  });
  assert.deepEqual(currentView(legacy), {
    tasks: [
      { index: 1, content: 'A', status: 'pending' },
      { index: 2, content: 'B', status: 'completed' },
    ],
  });
  assert.deepEqual(ledgerView(legacy).current.map((task) => task.content), ['A', 'B']);

  const result = updateLedger(legacy, { todos: ['C'] });
  assert.deepEqual(result.started, { index: 1, taskId: 'legacy-1-1', status: 'in_progress' });
  assert.deepEqual(currentView(result.state), {
    tasks: [
      { index: 1, content: 'A', status: 'in_progress' },
      { index: 2, content: 'B', status: 'completed' },
      { index: 3, content: 'C', status: 'pending' },
    ],
  });
  assert.deepEqual(ledgerView(result.state).current.map((task) => task.content), ['A', 'B', 'C']);
});

test('the default view starts at the last completed task of an ordered plan', () => {
  let state = planned();
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  state = startLedger(state, 2).state;
  assert.deepEqual(currentView(state), {
    tasks: [
      { index: 1, content: 'Confirm requirements', status: 'completed' },
      { index: 2, content: 'Implement ledger', status: 'in_progress' },
      { index: 3, content: 'Add tests', status: 'pending' },
    ],
  });

  state = finishLedger(state, 2).state;
  state = startLedger(state, 3).state;
  state = finishLedger(state, 3).state;
  assert.deepEqual(currentView(state), {
    tasks: [{ index: 3, content: 'Add tests', status: 'completed' }],
  });
  assert.deepEqual(currentView(emptyLedger()), { tasks: [] });
});

test('event folding reconstructs plan, void history and reports', () => {
  const write = writeLedger(emptyLedger(), ['One', 'Two']);
  let state = foldLedgerEvent(emptyLedger(), {
    type: 'todo/write', seq: 1, time: 100,
    data: {
      todos: legacyTodos(write.state),
      ledger: {
        version: 1, operation: 'write', mode: 'append', added: write.added.map(({ id, content }) => ({ id, content })), invalidatedIds: [],
      },
    },
  });
  assert.deepEqual(numberedPlan(state), numberedPlan(write.state));
  const started = startLedger(state, 1);
  state = foldLedgerEvent(state, {
    type: 'todo/write', seq: 2, time: 200,
    data: { todos: legacyTodos(started.state), ledger: { version: 1, operation: 'start', taskId: started.taskId } },
  });
  const reported = reportLedger(state, 1, true, 'Local');
  state = foldLedgerEvent(state, {
    type: 'todo/write', seq: 3, time: 300,
    data: { todos: legacyTodos(reported.state), ledger: { version: 1, operation: 'report', taskId: reported.taskId, report: reported.report } },
  });
  assert.equal(state.nodes[0].reports[0].seq, 3);
  const reordered = writeLedger(state, ['Replacement'], 1);
  state = foldLedgerEvent(state, {
    type: 'todo/write', seq: 4, time: 400,
    data: {
      todos: legacyTodos(reordered.state),
      ledger: {
        version: 1, operation: 'write', mode: 'reorder', reorderFrom: 1,
        added: reordered.added.map(({ id, content }) => ({ id, content })), invalidatedIds: ['t1', 't2'],
      },
    },
  });
  assert.equal(state.nodes[0].status, 'void');
  assert.equal(state.nodes[0].reports.length, 1);
  assert.deepEqual(numberedPlan(state), [{ index: 1, content: 'Replacement', status: 'pending' }]);
});

test('legacy local-task reports replay as issues', () => {
  let state = writeLedger(emptyLedger(), ['Task']).state;
  state = startLedger(state, 1).state;
  state = foldLedgerEvent(state, {
    type: 'todo/write', seq: 3, time: 300,
    data: {
      todos: legacyTodos(state),
      ledger: {
        version: 1, operation: 'report', taskId: 't1',
        report: { index: 1, inLocalTask: true, localTask: 'Legacy issue' },
      },
    },
  });
  assert.deepEqual(state.nodes[0].reports[0], {
    index: 1, inIssue: true, issue: 'Legacy issue', seq: 3,
  });
  assert.equal(currentView(state).tasks[0].issue, 'Legacy issue');
  state = foldLedgerEvent(state, {
    type: 'todo/write', seq: 4, time: 400,
    data: {
      todos: legacyTodos(state),
      ledger: {
        version: 1, operation: 'report', taskId: 't1',
        report: { index: 1, inLocalTask: false },
      },
    },
  });
  assert.deepEqual(state.nodes[0].reports[1], { index: 1, inIssue: false, seq: 4 });
  assert.equal(currentView(state).tasks[0].issue, undefined);
});

test('legacy whole-list events remain replayable', () => {
  const state = foldLedgerEvent(emptyLedger(), {
    type: 'todo/write', seq: 7, time: 700,
    data: { todos: [{ content: 'Legacy', status: 'completed' }] },
  });
  assert.deepEqual(numberedPlan(state), [{ index: 1, content: 'Legacy', status: 'completed' }]);
});

test('a new turn hides completed Dock items and keeps the legacy snapshot unchanged', () => {
  let state = writeLedger(emptyLedger(), ['One']).state;
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  const next = foldLedgerEvent(state, { type: 'turn/start', seq: 8, time: 800, data: { turn: 1 } });
  assert.deepEqual(dockTodos(next), []);
  assert.deepEqual(legacyTodos(next), [{ content: 'One', status: 'completed' }]);
});

test('tool/call shares nodes, current ids and turns while updating the call id', () => {
  const previous = planned();
  const next = foldLedgerEvent(previous, {
    type: 'tool/call',
    seq: 10,
    time: 1000,
    data: { callId: 'call-10' },
  });

  assert.notStrictEqual(next, previous);
  assert.equal(next.lastToolCallId, 'call-10');
  assert.strictEqual(next.nodes, previous.nodes);
  assert.strictEqual(next.currentIds, previous.currentIds);
  assert.strictEqual(next.turns, previous.turns);
  assert.strictEqual(next.currentTurn, previous.currentTurn);
  assert.strictEqual(next.lastReportTaskId, previous.lastReportTaskId);
  assert.strictEqual(ledgerView(next), ledgerView(previous), 'the shallow copy must reuse the memoized view');
});

test('repeating the same tool call id leaves the state untouched', () => {
  const first = foldLedgerEvent(planned(), {
    type: 'tool/call',
    seq: 11,
    time: 1100,
    data: { callId: 'call-11' },
  });
  const second = foldLedgerEvent(first, {
    type: 'tool/call',
    seq: 12,
    time: 1200,
    data: { callId: 'call-11' },
  });

  assert.strictEqual(second, first);
});

test('semantic folds invalidate the memoized view and produce fresh output', () => {
  const plannedState = planned();
  const startedState = startLedger(plannedState, 1).state;
  const turnOpen = turnEvent(startedState, 25, 'turn/start', 1);
  const transitions = [
    ['report', startedState, reportEvent(startedState, 21, 1, true, 'Fresh issue', 'report-21')],
    ['start', plannedState, startEvent(plannedState, 22, 1)],
    ['finish', startedState, finishEvent(startedState, 23, 1)],
    ['write', plannedState, writeEvent(plannedState, 24, ['Fourth'])],
    ['turn/start', startedState, turnOpen],
    ['turn/end', turnOpen, turnEvent(turnOpen, 26, 'turn/end', 1)],
  ];

  for (const [name, previous, next] of transitions) {
    const previousView = ledgerView(previous);
    const nextView = ledgerView(next);
    assert.notStrictEqual(nextView, previousView, `${name} must publish a new view object`);
    assert.deepEqual(nextView, ledgerView(structuredClone(next)), `${name} must match a fresh view computation`);
  }
});

test('the view memo key compares plan and turn inputs independently of nodes', () => {
  const state = planned();
  const variants = [
    ['currentIds', { ...state, currentIds: [...state.currentIds] }],
    ['turns', { ...state, turns: [...state.turns] }],
    ['currentTurn', { ...state, currentTurn: state.currentTurn + 1 }],
    ['lastReportTaskId', { ...state, lastReportTaskId: 't2' }],
  ];

  for (const [field, variant] of variants) {
    const baseView = ledgerView(state);
    const variantView = ledgerView(variant);
    assert.notStrictEqual(variantView, baseView, `${field} must invalidate the memo`);
    assert.deepEqual(variantView, ledgerView(structuredClone(variant)), `${field} must produce fresh output`);
  }

  const baseView = ledgerView(state);
  const ignored = { ...state, lastToolCallId: 'other-call' };
  assert.strictEqual(ledgerView(ignored), baseView, 'fields outside the view must keep the memo valid');
});

test('older start and report replay recover the latest tool call after a shallow copy', () => {
  let state = planned();
  state = foldLedgerEvent(state, {
    type: 'tool/call',
    seq: 30,
    time: 3000,
    data: { callId: 'older-call' },
  });

  state = startEvent(state, 31, 1);
  const started = state.nodes[0];
  assert.equal(started.startCallId, 'older-call');
  assert.equal(started.startSeq, 31);

  state = reportEvent(state, 32, 1, true, 'Recovered issue');
  assert.equal(state.nodes[0].reports[0].callId, 'older-call');
  assert.deepEqual(ledgerView(state).current[0].issues, [{
    name: 'Recovered issue',
    firstSeq: 32,
    lastSeq: 32,
    active: true,
    startCallId: 'older-call',
    startSeq: 32,
  }]);
});

test('read paths keep failing loudly when a current id has no node', () => {
  const state = planned();
  const broken = { ...state, currentIds: [...state.currentIds, 'missing'] };

  assert.throws(() => legacyTodos(broken), TypeError);
  assert.throws(() => numberedPlan(broken), TypeError);
  assert.throws(() => currentView(broken), TypeError);
});

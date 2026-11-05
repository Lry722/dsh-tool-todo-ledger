import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentView,
  dockTodos,
  emptyLedger,
  finishLedger,
  foldLedgerEvent,
  legacyTodos,
  numberedPlan,
  reportLedger,
  startLedger,
  updateLedger,
  writeLedger,
} from '../src/ledger.js';

function planned() {
  return writeLedger(emptyLedger(), ['Confirm requirements', 'Implement ledger', 'Add tests']).state;
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
  assert.throws(() => startLedger(state, 2), /finish earlier task 1/);
  const started = startLedger(state, 1).state;
  assert.throws(() => startLedger(started, 1), /not pending/);
  assert.throws(() => finishLedger(started, 2), /not in_progress/);
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

test('composite updates validate fully without mutating the input state', () => {
  const state = startLedger(planned(), 1).state;
  const before = structuredClone(state);
  assert.throws(() => updateLedger(state, { finish: 4 }), /task index must be between/);
  assert.throws(() => updateLedger(state, {}), /provide todos, reorderFrom, or finish/);
  assert.deepEqual(state, before);

  const removed = updateLedger(state, { reorderFrom: 2 });
  assert.deepEqual(numberedPlan(removed.state), [
    { index: 1, content: 'Confirm requirements', status: 'in_progress' },
  ]);
});

test('reports validate issues and expose only the active issue', () => {
  const started = startLedger(planned(), 1).state;
  assert.throws(() => reportLedger(started, 1, true), /issue.*required/);
  assert.throws(() => reportLedger(started, 1, false, 'Nested'), /omit `issue`/);
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
  assert.throws(() => reportLedger(topLevel, 1, true), /issue.*required.*entering/);
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
    index: 1, inIssue: true, issue: 'Legacy issue', seq: 3, time: 300,
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
  assert.deepEqual(state.nodes[0].reports[1], { index: 1, inIssue: false, seq: 4, time: 400 });
  assert.equal(currentView(state).tasks[0].issue, undefined);
});

test('legacy whole-list events remain replayable', () => {
  const state = foldLedgerEvent(emptyLedger(), {
    type: 'todo/write', seq: 7, time: 700,
    data: { todos: [{ content: 'Legacy', status: 'completed' }] },
  });
  assert.deepEqual(numberedPlan(state), [{ index: 1, content: 'Legacy', status: 'completed' }]);
});

test('a new turn hides completed Dock items without changing the compatibility snapshot', () => {
  let state = writeLedger(emptyLedger(), ['One']).state;
  state = startLedger(state, 1).state;
  state = finishLedger(state, 1).state;
  const next = foldLedgerEvent(state, { type: 'turn/start', seq: 8, time: 800, data: { turn: 1 } });
  assert.deepEqual(dockTodos(next), []);
  assert.deepEqual(legacyTodos(next), [{ content: 'One', status: 'completed' }]);
});

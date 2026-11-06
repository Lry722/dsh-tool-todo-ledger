import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_VERSION,
  adjacentTurn,
  defaultHistoryTurn,
  dockTodos,
  emptyLedger,
  finishLedger,
  foldLedgerEvent,
  ledgerView,
  legacyTodos,
  reportLedger,
  startLedger,
  writeLedger,
} from '../src/ledger.js';

function at(seq) {
  return { seq, time: seq * 100 };
}

function writeEvent(state, seq, todos, reorderFrom) {
  const result = writeLedger(state, todos, reorderFrom, at(seq));
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

function statusEvent(state, seq, operation, index) {
  const result = operation === 'start' ? startLedger(state, index) : finishLedger(state, index);
  return foldLedgerEvent(state, {
    type: 'todo/write',
    ...at(seq),
    data: {
      todos: legacyTodos(result.state),
      ledger: {
        version: LEDGER_VERSION,
        operation,
        taskId: result.taskId,
        ...(operation === 'start' ? { callId: `call-${seq}` } : {}),
      },
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

function taskById(turn, id) {
  return turn.tasks.find((task) => task.id === id);
}

test('turn history carries unfinished work and freezes each turn-end status', () => {
  let state = turnEvent(emptyLedger(), 1, 'turn/start', 1);
  state = writeEvent(state, 2, ['A', 'B']);
  state = statusEvent(state, 3, 'start', 1);
  state = statusEvent(state, 4, 'finish', 1);
  state = statusEvent(state, 5, 'start', 2);
  state = turnEvent(state, 6, 'turn/end', 1);

  state = turnEvent(state, 7, 'turn/start', 2);
  assert.deepEqual(state.turns.at(-1).taskIds, ['t2']);
  state = writeEvent(state, 8, ['C']);
  state = statusEvent(state, 9, 'finish', 2);
  state = writeEvent(state, 10, ['D'], 3);
  state = turnEvent(state, 11, 'turn/end', 2);
  state = turnEvent(state, 12, 'turn/start', 3);

  const view = ledgerView(state);
  const first = view.turns.find((turn) => turn.turn === 1);
  const second = view.turns.find((turn) => turn.turn === 2);
  const third = view.turns.find((turn) => turn.turn === 3);
  assert.deepEqual(first.tasks.map((task) => [task.id, task.status]), [
    ['t1', 'completed'],
    ['t2', 'in_progress'],
  ]);
  assert.deepEqual(second.tasks.map((task) => [task.id, task.status]), [
    ['t2', 'completed'],
    ['t3', 'void'],
    ['t4', 'pending'],
  ]);
  assert.equal(taskById(first, 't2').status, 'in_progress', 'later completion must not rewrite turn 1');
  assert.equal(taskById(second, 't2').status, 'completed', 'the same task has its own turn 2 status');
  assert.deepEqual(third.tasks.map((task) => [task.id, task.status]), [['t4', 'pending']]);
  assert.equal(defaultHistoryTurn(view.turns), 3, 'the latest non-empty turn is the default, even while it is open');
  assert.deepEqual(view.current.map((task) => [task.index, task.id, task.status]), [
    [1, 't1', 'completed'],
    [2, 't2', 'completed'],
    [3, 't4', 'pending'],
  ]);
  assert.deepEqual(dockTodos(state).map((task) => task.content), ['D']);
});

test('history preview separates task content with an ideographic space', () => {
  const state = writeEvent(emptyLedger(), 1, ['Review implementation, then verify', 'Run checks']);
  assert.equal(ledgerView(state).turns[0].preview, 'Review implementation, then verify\u3000Run checks');
});

test('empty turns remain selectable and Dock hides an empty new turn', () => {
  let state = turnEvent(emptyLedger(), 1, 'turn/start', 1);
  state = writeEvent(state, 2, ['Done']);
  state = statusEvent(state, 3, 'start', 1);
  state = statusEvent(state, 4, 'finish', 1);
  state = turnEvent(state, 5, 'turn/end', 1);
  state = turnEvent(state, 6, 'turn/start', 2);
  assert.deepEqual(state.turns.at(-1).taskIds, []);
  assert.deepEqual(dockTodos(state), []);
  state = turnEvent(state, 7, 'turn/end', 2);
  state = turnEvent(state, 8, 'turn/start', 3);

  const view = ledgerView(state);
  assert.deepEqual(view.turns.map((turn) => turn.turn), [0, 1, 2, 3]);
  assert.equal(view.turns.find((turn) => turn.turn === 2).total, 0);
  assert.equal(view.turns.find((turn) => turn.turn === 2).open, false);
  assert.equal(defaultHistoryTurn(view.turns), 1);
  assert.equal(adjacentTurn(view.turns, 1, 1), 2);
  assert.equal(adjacentTurn(view.turns, 2, 1), 3);
  assert.equal(adjacentTurn(view.turns, 0, -1), undefined);
  assert.equal(adjacentTurn(view.turns, 3, 1), undefined);
  assert.equal(adjacentTurn(view.turns, 99, 1), undefined);
});

test('turn zero preserves no-turn and legacy snapshot playback', () => {
  let state = foldLedgerEvent(emptyLedger(), {
    type: 'todo/write',
    ...at(1),
    data: { todos: [{ content: 'Legacy done', status: 'completed' }, { content: 'Legacy pending', status: 'pending' }] },
  });
  assert.equal(state.currentTurn, 0);
  assert.deepEqual(dockTodos(state).map((task) => task.content), ['Legacy done', 'Legacy pending']);
  assert.deepEqual(ledgerView(state).turns[0].tasks.map((task) => task.content), ['Legacy done', 'Legacy pending']);

  state = turnEvent(state, 2, 'turn/start', 1);
  assert.deepEqual(state.turns[0].endStatuses, { 'legacy-1-1': 'completed', 'legacy-1-2': 'pending' });
  assert.deepEqual(state.turns[1].taskIds, ['legacy-1-2']);
  assert.deepEqual(dockTodos(state).map((task) => task.content), ['Legacy pending']);
  assert.equal(defaultHistoryTurn(ledgerView(state).turns), 1);
});

test('open turns use live status while archived turns keep their snapshots', () => {
  let state = writeEvent(emptyLedger(), 1, ['Task']);
  state = statusEvent(state, 2, 'start', 1);
  let turn = ledgerView(state).turns[0];
  assert.equal(turn.open, true);
  assert.equal(turn.tasks[0].status, 'in_progress');
  assert.equal(defaultHistoryTurn(ledgerView(state).turns), 0);

  state = turnEvent(state, 3, 'turn/end', 0);
  state = statusEvent(state, 4, 'finish', 1);
  turn = ledgerView(state).turns[0];
  assert.equal(turn.open, false);
  assert.equal(turn.tasks[0].status, 'in_progress');
  assert.equal(ledgerView(state).current[0].status, 'completed');
});

test('issue summaries deduplicate names and filter reports by turn boundaries', () => {
  let state = turnEvent(emptyLedger(), 1, 'turn/start', 1);
  state = writeEvent(state, 2, ['Task']);
  state = statusEvent(state, 3, 'start', 1);
  state = reportEvent(state, 4, 1, true, 'Alpha');
  state = reportEvent(state, 5, 1, true);
  state = reportEvent(state, 6, 1, false);
  state = reportEvent(state, 7, 1, true, 'Beta');
  state = reportEvent(state, 8, 1, true, 'Alpha');
  state = turnEvent(state, 9, 'turn/end', 1);
  state = turnEvent(state, 10, 'turn/start', 2);
  state = reportEvent(state, 11, 1, true, 'Gamma');
  state = turnEvent(state, 12, 'turn/end', 2);

  const view = ledgerView(state);
  assert.deepEqual(view.current[0].issues.map((issue) => [issue.name, issue.firstSeq, issue.lastSeq, issue.active]), [
    ['Alpha', 4, 8, false],
    ['Beta', 7, 7, false],
    ['Gamma', 11, 11, true],
  ]);
  const first = view.turns.find((turn) => turn.turn === 1);
  const second = view.turns.find((turn) => turn.turn === 2);
  assert.deepEqual(first.tasks[0].issues.map((issue) => issue.name), ['Alpha', 'Beta']);
  assert.deepEqual(second.tasks[0].issues.map((issue) => issue.name), ['Gamma']);
  assert.equal(first.tasks[0].issues[0].lastSeq, 8);
  assert.equal(second.tasks[0].issues[0].active, true, 'active is a current-issue marker, not a completion claim');
  assert.equal(Object.hasOwn(view.current[0], 'reports'), false);
  assert.equal(JSON.stringify(view).includes('"inIssue"'), false);
});

test('leaving an issue or finishing its task only clears the active marker', () => {
  let state = writeEvent(emptyLedger(), 1, ['Task']);
  state = statusEvent(state, 2, 'start', 1);
  state = reportEvent(state, 3, 1, true, 'Investigation');
  state = reportEvent(state, 4, 1, false);
  let issues = ledgerView(state).current[0].issues;
  assert.deepEqual(issues.map((issue) => [issue.name, issue.active]), [['Investigation', false]]);
  state = reportEvent(state, 5, 1, true, 'Investigation');
  state = statusEvent(state, 6, 'finish', 1);
  issues = ledgerView(state).current[0].issues;
  assert.deepEqual(issues, [{ name: 'Investigation', firstSeq: 3, lastSeq: 5, active: false }]);
});

test('issue navigation uses the latest same-name report inside each visible turn', () => {
  let state = turnEvent(emptyLedger(), 1, 'turn/start', 1);
  state = writeEvent(state, 2, ['Task']);
  state = statusEvent(state, 3, 'start', 1);
  state = reportEvent(state, 4, 1, true, 'Alpha', 'report-4');
  state = reportEvent(state, 5, 1, true, undefined, 'report-5');
  state = turnEvent(state, 6, 'turn/end', 1);
  state = turnEvent(state, 7, 'turn/start', 2);
  state = reportEvent(state, 8, 1, true, 'Alpha', 'report-8');
  state = turnEvent(state, 9, 'turn/end', 2);

  const view = ledgerView(state);
  const target = (issue) => [issue.name, issue.lastSeq, issue.startCallId, issue.startSeq];
  assert.deepEqual(view.current[0].issues.map(target), [['Alpha', 8, 'report-8', 8]]);
  const first = view.turns.find((turn) => turn.turn === 1);
  const second = view.turns.find((turn) => turn.turn === 2);
  assert.deepEqual(first.tasks[0].issues.map(target), [['Alpha', 5, 'report-5', 5]]);
  assert.deepEqual(second.tasks[0].issues.map(target), [['Alpha', 8, 'report-8', 8]]);
});

test('history task navigation fields survive turn snapshots and voiding', () => {
  let state = writeEvent(emptyLedger(), 1, ['Task']);
  state = statusEvent(state, 2, 'start', 1);
  state = turnEvent(state, 3, 'turn/end', 0);
  state = writeEvent(state, 4, [], 1);
  const view = ledgerView(state);
  assert.deepEqual(view.turns[0].tasks[0], {
    id: 't1',
    content: 'Task',
    status: 'in_progress',
    startCallId: 'call-2',
    startSeq: 2,
    issues: [],
  });
  assert.equal(view.current.length, 0);
});

test('archived turns only expose navigation that happened before turn end', () => {
  let state = turnEvent(emptyLedger(), 1, 'turn/start', 1);
  state = writeEvent(state, 2, ['A', 'B']);
  state = statusEvent(state, 3, 'start', 1);
  state = turnEvent(state, 4, 'turn/end', 1);
  state = turnEvent(state, 5, 'turn/start', 2);
  state = statusEvent(state, 6, 'finish', 1);
  state = statusEvent(state, 7, 'start', 2);

  let view = ledgerView(state);
  const first = view.turns.find((turn) => turn.turn === 1);
  const second = view.turns.find((turn) => turn.turn === 2);
  const nav = (task) => [task.startCallId, task.startSeq];
  assert.deepEqual(nav(taskById(first, 't1')), ['call-3', 3], 'a start inside turn 1 stays visible');
  assert.deepEqual(nav(taskById(first, 't2')), [undefined, undefined], 'B started after turn 1 closed');
  assert.equal(Object.hasOwn(taskById(first, 't2'), 'startCallId'), false);
  assert.equal(Object.hasOwn(taskById(first, 't2'), 'startSeq'), false);
  assert.deepEqual(nav(taskById(second, 't2')), ['call-7', 7], 'the open turn keeps live navigation');
  assert.deepEqual(view.current.map((task) => [task.id, task.startCallId, task.startSeq]), [
    ['t1', 'call-3', 3],
    ['t2', 'call-7', 7],
  ], 'current plan navigation remains live');

  state = turnEvent(state, 8, 'turn/end', 2);
  state = turnEvent(state, 9, 'turn/start', 3);
  view = ledgerView(state);
  const archivedSecond = view.turns.find((turn) => turn.turn === 2);
  assert.deepEqual(nav(taskById(archivedSecond, 't2')), ['call-7', 7], 'a start inside turn 2 survives archiving');
});

test('writes after turn end wait for the next turn and never join the archive', () => {
  let state = turnEvent(emptyLedger(), 1, 'turn/start', 1);
  state = writeEvent(state, 2, ['A']);
  state = statusEvent(state, 3, 'start', 1);
  state = turnEvent(state, 4, 'turn/end', 1);

  const archived = ledgerView(state).turns.find((turn) => turn.turn === 1);
  state = writeEvent(state, 5, ['B']);
  const closedTurn = state.turns.find((turn) => turn.turn === 1);
  assert.deepEqual(closedTurn.taskIds, ['t1'], 'a closed turn must not collect later writes');
  assert.deepEqual(ledgerView(state).turns.find((turn) => turn.turn === 1), archived);

  state = turnEvent(state, 6, 'turn/start', 2);
  const nextTurn = state.turns.find((turn) => turn.turn === 2);
  assert.deepEqual(nextTurn.taskIds, ['t1', 't2']);
  const view = ledgerView(state);
  const second = view.turns.find((turn) => turn.turn === 2);
  assert.deepEqual(second.tasks.map((task) => [task.id, task.content, task.status]), [
    ['t1', 'A', 'in_progress'],
    ['t2', 'B', 'pending'],
  ]);
  assert.deepEqual(
    view.turns.filter((turn) => turn.tasks.some((task) => task.id === 't2')).map((turn) => turn.turn),
    [2],
    'B belongs to turn 2 only',
  );
});

test('node lookup preserves ids and ordering when the nodes array is shuffled', () => {
  const base = writeEvent(emptyLedger(), 1, ['A', 'B', 'C']);
  const state = {
    ...base,
    nodes: [base.nodes[2], base.nodes[0], base.nodes[1]],
    turns: [{ ...base.turns[0], taskIds: ['t3', 't1', 't2'] }],
  };

  const view = ledgerView(state);
  assert.deepEqual(view.current.map((task) => [task.id, task.index, task.content]), [
    ['t1', 1, 'A'],
    ['t2', 2, 'B'],
    ['t3', 3, 'C'],
  ]);
  assert.deepEqual(view.dock.map((task) => task.content), ['C', 'A', 'B']);
  assert.deepEqual(view.turns[0].tasks.map((task) => task.id), ['t3', 't1', 't2']);
  assert.deepEqual(legacyTodos(state), [
    { content: 'A', status: 'pending' },
    { content: 'B', status: 'pending' },
    { content: 'C', status: 'pending' },
  ]);
});

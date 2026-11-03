import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dockTodos,
  emptyLedger,
  finishLedger,
  legacyTodos,
  reportLedger,
  startLedger,
  writeLedger,
} from '../src/ledger.js';

test('dock view exposes only the active local task and a top-level report clears it', () => {
  let state = writeLedger(emptyLedger(), ['Task']).state;
  state = startLedger(state, 1).state;
  assert.deepEqual(dockTodos(state), [{ content: 'Task', status: 'in_progress' }]);
  state = reportLedger(state, 1, true, 'Inspect the Client').state;
  assert.deepEqual(dockTodos(state), [{ content: 'Task', status: 'in_progress', localTask: 'Inspect the Client' }]);
  state = reportLedger(state, 1, true).state;
  assert.deepEqual(dockTodos(state), [{ content: 'Task', status: 'in_progress', localTask: 'Inspect the Client' }]);
  state = reportLedger(state, 1, false).state;
  assert.deepEqual(dockTodos(state), [{ content: 'Task', status: 'in_progress' }]);
});

test('finishing a task hides its active local task without changing compatibility snapshots', () => {
  let state = writeLedger(emptyLedger(), ['Task']).state;
  state = startLedger(state, 1).state;
  state = reportLedger(state, 1, true, 'Local').state;
  state = finishLedger(state, 1).state;
  assert.deepEqual(dockTodos(state), [{ content: 'Task', status: 'completed' }]);
  assert.deepEqual(legacyTodos(state), [{ content: 'Task', status: 'completed' }]);
});

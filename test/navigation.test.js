import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_VERSION,
  dockTodos,
  emptyLedger,
  foldLedgerEvent,
  legacyTodos,
  writeLedger,
} from '../src/ledger.js';

test('start events expose their tool-call target and keep it after completion', () => {
  let state = writeLedger(emptyLedger(), ['Task']).state;
  const started = { ...state, nodes: state.nodes.map((node) => ({ ...node, status: 'in_progress' })) };
  state = foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 42,
    time: 4200,
    data: {
      todos: legacyTodos(started),
      ledger: { version: LEDGER_VERSION, operation: 'start', taskId: 't1', callId: 'call-123' },
    },
  });
  assert.deepEqual(dockTodos(state), [{
    content: 'Task', status: 'in_progress', startCallId: 'call-123', startSeq: 42,
  }]);
  state = foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 43,
    time: 4300,
    data: {
      todos: [{ content: 'Task', status: 'completed' }],
      ledger: { version: LEDGER_VERSION, operation: 'finish', taskId: 't1' },
    },
  });
  assert.deepEqual(dockTodos(state), [{
    content: 'Task', status: 'completed', startCallId: 'call-123', startSeq: 42,
  }]);
});

test('tasks without a replayed start call keep no navigation target', () => {
  const state = writeLedger(emptyLedger(), ['Pending']).state;
  assert.deepEqual(dockTodos(state), [{ content: 'Pending', status: 'pending' }]);
});

test('older start operations recover their enclosing tool call during replay', () => {
  let state = writeLedger(emptyLedger(), ['Existing']).state;
  state = foldLedgerEvent(state, {
    type: 'tool/call', seq: 10, time: 1000, data: { callId: 'older-call' },
  });
  const started = { ...state, nodes: state.nodes.map((node) => ({ ...node, status: 'in_progress' })) };
  state = foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 11,
    time: 1100,
    data: {
      todos: legacyTodos(started),
      ledger: { version: LEDGER_VERSION, operation: 'start', taskId: 't1' },
    },
  });
  assert.deepEqual(dockTodos(state), [{
    content: 'Existing', status: 'in_progress', startCallId: 'older-call', startSeq: 11,
  }]);
});

test('legacy snapshots preserve the write that first made each task active', () => {
  let state = foldLedgerEvent(emptyLedger(), {
    type: 'tool/call', seq: 20, time: 2000, data: { callId: 'legacy-a' },
  });
  state = foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 21,
    time: 2100,
    data: { todos: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] },
  });
  const firstId = state.nodes[0].id;
  state = foldLedgerEvent(state, {
    type: 'tool/call', seq: 22, time: 2200, data: { callId: 'legacy-b' },
  });
  state = foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 23,
    time: 2300,
    data: { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] },
  });
  assert.equal(state.nodes[0].id, firstId);
  assert.deepEqual(dockTodos(state), [
    { content: 'A', status: 'completed', startCallId: 'legacy-a', startSeq: 21 },
    { content: 'B', status: 'in_progress', startCallId: 'legacy-b', startSeq: 23 },
  ]);
});

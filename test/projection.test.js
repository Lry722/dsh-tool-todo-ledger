import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
import { HISTORY_PROJECTION_KEY } from '../src/history.js';
import {
  LEDGER_VERSION,
  emptyLedger,
  foldLedgerEvent,
  ledgerView,
  legacyTodos,
  reportLedger,
  startLedger,
  updateLedger,
  writeLedger,
} from '../src/ledger.js';

function projectionHarness() {
  const projections = new Map();
  const ctx = {
    sessionProjections: {
      register(definition) {
        projections.set(definition.key, definition);
      },
    },
    on() {},
    agents: {
      list() {
        return [];
      },
    },
  };
  apply(ctx, { reviewEnabled: false });
  const projection = projections.get('todoLedger');
  assert.ok(projection, 'apply must register the todoLedger projection');
  assert.ok(projections.get(HISTORY_PROJECTION_KEY), 'apply must register the history projection');
  return projection;
}

function historyHarness() {
  const projections = new Map();
  apply({
    sessionProjections: { register: (definition) => projections.set(definition.key, definition) },
    on() {},
    agents: { list: () => [] },
  }, { reviewEnabled: false });
  return projections.get(HISTORY_PROJECTION_KEY);
}

function assertParses(schema, value, label) {
  const result = schema.safeParse(value);
  assert.equal(result.success, true, `${label}: ${JSON.stringify(result.error?.issues ?? result.error)}`);
}

test('projection schemas parse empty and normal ledgers', () => {
  const projection = projectionHarness();
  const empty = emptyLedger();
  assertParses(projection.stateSchema, empty, 'empty state');
  assertParses(projection.wire.viewSchema, ledgerView(empty), 'empty view');

  const normal = updateLedger(emptyLedger(), { todos: ['Plan', 'Implement'] }).state;
  assertParses(projection.stateSchema, normal, 'normal state');
  assertParses(projection.wire.viewSchema, ledgerView(normal), 'normal view');
});

test('legacy reports without an index remain schema-valid', () => {
  const projection = projectionHarness();
  let state = writeLedger(emptyLedger(), ['Task']).state;
  state = startLedger(state, 1).state;
  state = foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 2,
    time: 200,
    data: {
      todos: legacyTodos(state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'report',
        taskId: 't1',
        report: { inLocalTask: false },
      },
    },
  });
  assert.equal(Object.hasOwn(state.nodes[0].reports[0], 'index'), true);
  assert.equal(state.nodes[0].reports[0].index, undefined);

  assertParses(projection.stateSchema, state, 'legacy state');
  assertParses(projection.wire.viewSchema, ledgerView(state), 'legacy view');
});

test('new reports keep their index after folding', () => {
  const projection = projectionHarness();
  let state = writeLedger(emptyLedger(), ['Task']).state;
  state = startLedger(state, 1).state;
  const result = reportLedger(state, 1, true, 'Fresh issue');
  state = foldLedgerEvent(state, {
    type: 'todo/write',
    seq: 3,
    time: 300,
    data: {
      todos: legacyTodos(result.state),
      ledger: {
        version: LEDGER_VERSION,
        operation: 'report',
        taskId: result.taskId,
        report: result.report,
      },
    },
  });
  assert.equal(state.nodes[0].reports[0].index, 1);

  assertParses(projection.stateSchema, state, 'new report state');
  assertParses(projection.wire.viewSchema, ledgerView(state), 'new report view');
});

test('history projection retains operations instead of plan snapshots', () => {
  const projection = historyHarness();
  let state = projection.init();
  assert.deepEqual(state, []);

  state = projection.apply(state, { type: 'tool/call', seq: 1, time: 10, data: { callId: 'call-1' } });
  assert.deepEqual(state, []);

  const todos = [{ content: 'Task', status: 'pending' }];
  const ledger = { version: LEDGER_VERSION, operation: 'write', added: [{ id: 't1', content: 'Task' }] };
  const next = projection.apply(state, { type: 'todo/write', seq: 2, time: 20, data: { todos, ledger } });
  assert.deepEqual(next, [{ seq: 2, time: 20, ledger }]);
  assert.deepEqual(state, []);

  // A legacy snapshot has no delta; its payload is the only record of that plan.
  const legacyData = { todos };
  const legacy = projection.apply(next, { type: 'todo/write', seq: 3, time: 30, data: legacyData });
  assert.deepEqual(legacy, [{ seq: 2, time: 20, ledger }, { seq: 3, time: 30, data: legacyData }]);
  assert.deepEqual(next, [{ seq: 2, time: 20, ledger }]);
  assert.equal(projection.stateSchema.safeParse(legacy).success, true);
});

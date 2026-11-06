import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
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
  let projection;
  const ctx = {
    sessionProjections: {
      register(definition) {
        projection = definition;
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
  assert.ok(projection, 'apply must register the todoLedger projection');
  return projection;
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

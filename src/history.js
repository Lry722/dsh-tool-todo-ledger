import { z as zod } from 'zod';

export const HISTORY_PROJECTION_KEY = 'todoLedgerHistory';

const historyEventSchema = zod.object({
  seq: zod.number(),
  time: zod.number(),
  // Versioned operations keep only the semantic delta. `todos` repeats the whole
  // plan on every event and the session log already carries it for the official
  // todo projection, so retaining it here only duplicated the ledger state.
  ledger: zod.any().optional(),
  // Legacy snapshots have no delta; their full payload is the only record of the
  // plan shape at that point, so it stays verbatim.
  data: zod.any().optional(),
});

const historyStateSchema = zod.array(historyEventSchema);

export function emptyHistory() {
  return [];
}

/**
 * Retain the durable `todo/write` records for the opt-in export.
 * The ledger projection already derives task state; this projection only keeps
 * the original operations so export never has to read the session log through a
 * deprecated synchronous API.
 * @param state - retained events, oldest first.
 * @param event - the next committed session event.
 * @returns the same array for unrelated events, or a new retained snapshot.
 */
export function recordHistoryEvent(state, event) {
  if (event.type !== 'todo/write' || !event.data) return state;
  if (!event.data.ledger) return [...state, { seq: event.seq, time: event.time, data: event.data }];
  return [...state, { seq: event.seq, time: event.time, ledger: event.data.ledger }];
}

export function historyProjection() {
  return {
    key: HISTORY_PROJECTION_KEY,
    stateSchema: historyStateSchema,
    init: emptyHistory,
    apply: recordHistoryEvent,
    stateVersion: 2,
  };
}

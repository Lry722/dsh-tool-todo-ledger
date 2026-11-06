import { z as zod } from 'zod';

export const HISTORY_PROJECTION_KEY = 'todoLedgerHistory';

const historyEventSchema = zod.object({
  seq: zod.number(),
  time: zod.number(),
  data: zod.any(),
});

const historyStateSchema = zod.array(historyEventSchema);

export function emptyHistory() {
  return [];
}

/**
 * Retain raw `todo/write` events for the opt-in export.
 * The ledger projection already derives task state; this projection only keeps
 * the original durable records so export never has to read the session log
 * through a deprecated synchronous API.
 * @param state - retained events, oldest first.
 * @param event - the next committed session event.
 * @returns the same array for unrelated events, or a new retained snapshot.
 */
export function recordHistoryEvent(state, event) {
  if (event.type !== 'todo/write') return state;
  return [...state, { seq: event.seq, time: event.time, data: event.data }];
}

export function historyProjection() {
  return {
    key: HISTORY_PROJECTION_KEY,
    stateSchema: historyStateSchema,
    init: emptyHistory,
    apply: recordHistoryEvent,
    stateVersion: 1,
  };
}

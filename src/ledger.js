import { LEDGER_MESSAGES, fillPrompt } from './prompts.js';

export const LEDGER_VERSION = 1;
export const TODO_STATUSES = ['pending', 'in_progress', 'completed'];

function ledgerError(key, values) {
  return new Error(fillPrompt(LEDGER_MESSAGES[key], values));
}

export function emptyLedger() {
  return {
    version: LEDGER_VERSION,
    nodes: [],
    currentIds: [],
    lastReportTaskId: null,
    lastToolCallId: null,
    nextTaskNumber: 1,
    currentTurn: 0,
    turns: [{ turn: 0, startSeq: 0, startTime: 0, taskIds: [] }],
  };
}

function clone(value) {
  return structuredClone(value);
}

// Read-path node index. Keyed by the `state.nodes` array reference: every
// semantic fold replaces that array and never mutates a published state, so an
// index can be reused for as long as the array identity is unchanged. Keeping
// the first node for a duplicated id mirrors the old `nodes.find` behavior.
const nodeIndexCache = new WeakMap();

function nodeById(state, id) {
  let index = nodeIndexCache.get(state.nodes);
  if (index === undefined) {
    index = new Map();
    for (const node of state.nodes) {
      if (!index.has(node.id)) index.set(node.id, node);
    }
    nodeIndexCache.set(state.nodes, index);
  }
  return index.get(id);
}

function openTurn(state) {
  return state.turns.find((entry) => entry.turn === state.currentTurn);
}

function rememberInTurn(state, taskId) {
  const turn = openTurn(state);
  if (turn && !turn.taskIds.includes(taskId)) turn.taskIds.push(taskId);
}

function closeTurn(state, turn, seq, time) {
  if (!turn || turn.endStatuses) return;
  turn.endSeq = seq;
  turn.endTime = time;
  turn.endStatuses = {};
  for (const id of turn.taskIds) {
    const task = state.nodes.find((node) => node.id === id);
    if (task) turn.endStatuses[id] = task.status;
  }
}

function openNextTurn(state, event) {
  const number = event.data?.turn;
  if (!Number.isInteger(number) || number <= state.currentTurn) return state;
  const next = clone(state);
  closeTurn(next, openTurn(next), event.seq, event.time);
  const taskIds = next.currentIds.filter((id) => {
    const task = next.nodes.find((node) => node.id === id);
    return task && (task.status === 'pending' || task.status === 'in_progress');
  });
  next.currentTurn = number;
  next.turns.push({ turn: number, startSeq: event.seq, startTime: event.time, taskIds });
  return next;
}

function closeCurrentTurn(state, event) {
  if (event.data?.turn !== state.currentTurn) return state;
  const turn = openTurn(state);
  if (!turn || turn.endStatuses) return state;
  const next = clone(state);
  closeTurn(next, openTurn(next), event.seq, event.time);
  return next;
}

// Old reports used localTask; normalize them when replaying existing sessions.
function normalizeReport(report) {
  const inIssue = report?.inIssue ?? report?.inLocalTask;
  const rawIssue = report?.issue ?? report?.localTask;
  const issue = typeof rawIssue === 'string' && rawIssue.trim().length > 0 ? rawIssue.trim() : undefined;
  return { index: report?.index, inIssue: inIssue === true, ...(issue === undefined ? {} : { issue }) };
}

function contentOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw ledgerError('taskRequired');
  }
  return value.trim();
}

export function normalizeTasks(values) {
  if (!Array.isArray(values)) throw ledgerError('todosArray');
  const tasks = values.map(contentOf);
  const unique = new Set(tasks);
  if (unique.size !== tasks.length) throw ledgerError('taskUnique');
  return tasks;
}

export function taskAt(state, index, toolName) {
  if (!Number.isInteger(index) || index < 1 || index > state.currentIds.length) {
    throw ledgerError('taskIndexRange', { tool: toolName, count: state.currentIds.length });
  }
  const id = state.currentIds[index - 1];
  const task = state.nodes.find((node) => node.id === id);
  if (!task) throw ledgerError('planInconsistent', { tool: toolName, index });
  return { id, task };
}

export function legacyTodos(state) {
  return state.currentIds.map((id) => {
    const task = nodeById(state, id);
    return { content: task.content, status: task.status };
  });
}

function activeIssue(state, taskId) {
  if (state.lastReportTaskId !== taskId) return undefined;
  const task = nodeById(state, taskId);
  if (task?.status !== 'in_progress') return undefined;
  const latest = task.reports.at(-1);
  if (!latest?.inIssue || typeof latest.issue !== 'string') return undefined;
  return { name: latest.issue, seq: latest.seq, callId: latest.callId };
}

export function dockTodos(state) {
  const turn = openTurn(state);
  const current = new Set(state.currentIds);
  const ids = turn ? turn.taskIds : state.currentIds;
  return ids.filter((id) => current.has(id)).map((id) => {
    const task = nodeById(state, id);
    const result = { content: task.content, status: task.status };
    if (typeof task.startCallId === 'string' && typeof task.startSeq === 'number') {
      result.startCallId = task.startCallId;
      result.startSeq = task.startSeq;
    }
    const issue = activeIssue(state, id);
    if (issue) {
      result.issue = issue.name;
      if (typeof issue.callId === 'string' && typeof issue.seq === 'number') {
        result.issueCallId = issue.callId;
        result.issueSeq = issue.seq;
      }
    }
    return result;
  });
}

// Validate and apply a write to a mutable working copy. Public entry points
// clone first; the composite update reuses one working copy across steps.
function applyWrite(state, rawTasks, reorderFrom, meta) {
  const tasks = normalizeTasks(rawTasks);
  const reorder = reorderFrom !== undefined;
  if (!reorder && tasks.length === 0) throw ledgerError('appendTaskRequired');
  if (reorder && (!Number.isInteger(reorderFrom) || reorderFrom < 1 || reorderFrom > state.currentIds.length)) {
    throw ledgerError('reorderRange', { count: state.currentIds.length });
  }

  const invalidatedIds = [];
  const invalidated = [];
  if (reorder) {
    for (let index = reorderFrom - 1; index < state.currentIds.length; index += 1) {
      const id = state.currentIds[index];
      const oldTask = state.nodes.find((node) => node.id === id);
      if (oldTask.status === 'completed') continue;
      invalidatedIds.push(id);
      invalidated.push({ oldIndex: index + 1, id, content: oldTask.content, status: oldTask.status });
    }
    if (invalidatedIds.length === 0 && tasks.length === 0) {
      throw ledgerError('reorderNoop');
    }
  }

  // Full validation finished above; everything below mutates the working copy.
  if (reorder) {
    const discarded = new Set(invalidatedIds);
    state.currentIds = state.currentIds.filter((id) => !discarded.has(id));
    for (const node of state.nodes) {
      if (!discarded.has(node.id)) continue;
      node.status = 'void';
      node.voidedSeq = meta.seq;
      node.voidedTime = meta.time;
    }
  }

  const added = [];
  for (const content of tasks) {
    const id = `t${state.nextTaskNumber}`;
    state.nextTaskNumber += 1;
    state.nodes.push({
      id,
      content,
      status: 'pending',
      reports: [],
      createdSeq: meta.seq,
      createdTime: meta.time,
    });
    state.currentIds.push(id);
    rememberInTurn(state, id);
    added.push({ id, content });
  }
  if (reorder) state.lastReportTaskId = null;
  // `nodes` gained entries under the same array identity; drop any cached
  // read-path index so later lookups see the appended nodes.
  nodeIndexCache.delete(state.nodes);

  const numberedAdded = added.map((task) => ({
    index: state.currentIds.indexOf(task.id) + 1,
    ...task,
  }));
  return { mode: reorder ? 'reorder' : 'append', reorderFrom, added: numberedAdded, invalidated };
}

export function writeLedger(state, rawTasks, reorderFrom, meta = { seq: 0, time: 0 }) {
  const next = clone(state);
  return { state: next, ...applyWrite(next, rawTasks, reorderFrom, meta) };
}

function applyStart(state, index) {
  const { id, task } = taskAt(state, index, 'todo_write');
  if (task.status !== 'pending') throw ledgerError('startNotPending', { index, status: task.status });
  for (let previous = 0; previous < index - 1; previous += 1) {
    const previousTask = state.nodes.find((node) => node.id === state.currentIds[previous]);
    if (previousTask.status !== 'completed') {
      throw ledgerError('startBlocked', { previous: previous + 1, index });
    }
  }
  task.status = 'in_progress';
  return id;
}

export function startLedger(state, index) {
  const next = clone(state);
  return { state: next, taskId: applyStart(next, index) };
}

function applyFinish(state, index) {
  const { id, task } = taskAt(state, index, 'todo_write');
  if (task.status !== 'in_progress') {
    throw ledgerError('finishNotActive', { index, status: task.status });
  }
  task.status = 'completed';
  return id;
}

export function finishLedger(state, index) {
  const next = clone(state);
  return { state: next, taskId: applyFinish(next, index) };
}

function hasInProgress(state) {
  return state.currentIds.some((id) => state.nodes.find((node) => node.id === id)?.status === 'in_progress');
}

function firstPendingIndex(state) {
  return state.currentIds.findIndex((id) => state.nodes.find((node) => node.id === id)?.status === 'pending') + 1;
}

export function updateLedger(state, args, meta = { seq: 0, time: 0 }) {
  const { todos, reorderFrom, finish } = args;
  // One working copy for every step. Helpers validate before mutating, so a
  // failure anywhere leaves both the published state and this copy untouched.
  const next = clone(state);
  let finished;
  let write;
  let started;
  const operations = [];

  if (finish !== undefined) {
    const taskId = applyFinish(next, finish);
    finished = { index: finish, taskId, status: 'completed' };
    operations.push({
      todos: legacyTodos(next),
      ledger: { operation: 'finish', taskId },
    });
  }

  if (todos !== undefined || reorderFrom !== undefined) {
    write = applyWrite(next, todos ?? [], reorderFrom, meta);
    operations.push({
      todos: legacyTodos(next),
      ledger: {
        operation: 'write',
        mode: write.mode,
        ...(write.reorderFrom === undefined ? {} : { reorderFrom: write.reorderFrom }),
        added: write.added.map(({ id, content }) => ({ id, content })),
        invalidatedIds: write.invalidated.map((task) => task.id),
      },
    });
  }

  if (!hasInProgress(next)) {
    const index = firstPendingIndex(next);
    if (index > 0) {
      const taskId = applyStart(next, index);
      started = { index, taskId, status: 'in_progress' };
      operations.push({
        todos: legacyTodos(next),
        ledger: { operation: 'start', taskId },
      });
    }
  }

  if (operations.length === 0) {
    throw ledgerError('operationRequired');
  }
  return { state: next, operations, finished, write, started };
}

export function reportLedger(state, index, inIssue, rawIssue) {
  const { id, task } = taskAt(state, index, 'todo_report');
  if (typeof inIssue !== 'boolean') throw ledgerError('inIssueBoolean');
  if (rawIssue !== undefined && (typeof rawIssue !== 'string' || rawIssue.trim().length === 0)) {
    throw ledgerError('issueString');
  }
  let issue = rawIssue?.trim();
  if (inIssue && issue === undefined) {
    const previous = state.lastReportTaskId === id ? task.reports.at(-1) : undefined;
    if (previous?.inIssue !== true || typeof previous.issue !== 'string') {
      throw ledgerError('issueRequired');
    }
    issue = previous.issue;
  }
  if (!inIssue && issue !== undefined) {
    throw ledgerError('issueOmitted');
  }
  if (task.status !== 'in_progress') {
    throw ledgerError('reportInactiveTask', { index, status: task.status });
  }
  if (state.lastReportTaskId !== null && state.lastReportTaskId !== id) {
    const previous = state.nodes.find((node) => node.id === state.lastReportTaskId);
    if (previous && previous.status !== 'completed') {
      throw ledgerError('reportSwitchBlocked');
    }
  }
  const report = { index, inIssue, ...(issue === undefined ? {} : { issue }) };
  const next = clone(state);
  next.nodes.find((node) => node.id === id).reports.push(report);
  next.lastReportTaskId = id;
  return { state: next, taskId: id, report };
}

export function numberedPlan(state) {
  return state.currentIds.map((id, index) => {
    const task = nodeById(state, id);
    return { index: index + 1, content: task.content, status: task.status };
  });
}

export function currentView(state) {
  let first = 0;
  for (let index = 0; index < state.currentIds.length; index += 1) {
    const task = nodeById(state, state.currentIds[index]);
    if (task.status === 'completed') first = index;
  }
  const tasks = state.currentIds.slice(first).map((id, offset) => {
    const task = nodeById(state, id);
    const result = { index: first + offset + 1, content: task.content, status: task.status };
    if (task.status === 'in_progress' && state.lastReportTaskId === id && task.reports.length > 0) {
      const latest = task.reports.at(-1);
      if (latest.inIssue) result.issue = latest.issue;
    }
    return result;
  });
  return { tasks };
}

function foldLegacySnapshot(state, event) {
  const next = clone(state);
  const previous = next.currentIds.map((id) => next.nodes.find((node) => node.id === id));
  next.nodes = event.data.todos.map((todo, index) => {
    const existing = previous[index]?.content === todo.content ? previous[index] : undefined;
    const priorStatus = existing?.status ?? 'pending';
    const node = existing ?? {
      id: `legacy-${event.seq}-${index + 1}`,
      content: todo.content,
      status: todo.status,
      reports: [],
      createdSeq: event.seq,
      createdTime: event.time,
    };
    node.status = todo.status;
    if (todo.status === 'in_progress' && priorStatus !== 'in_progress' && typeof state.lastToolCallId === 'string') {
      node.startCallId = state.lastToolCallId;
      node.startSeq = event.seq;
    }
    return node;
  });
  next.currentIds = next.nodes.map((node) => node.id);
  for (const id of next.currentIds) rememberInTurn(next, id);
  next.lastReportTaskId = null;
  return next;
}

export function foldLedgerEvent(state, event) {
  if (event.type === 'turn/start') return openNextTurn(state, event);
  if (event.type === 'turn/end') return closeCurrentTurn(state, event);
  if (event.type === 'tool/call' && typeof event.data?.callId === 'string') {
    if (state.lastToolCallId === event.data.callId) return state;
    // Shallow copy: the view ignores lastToolCallId, so the projection can share
    // nodes/currentIds/turns and reuse the cached view object.
    return { ...state, lastToolCallId: event.data.callId };
  }
  if (event.type !== 'todo/write' || !event.data || !Array.isArray(event.data.todos)) return state;
  const operation = event.data.ledger;
  if (!operation || operation.version !== LEDGER_VERSION) {
    return operation ? state : foldLegacySnapshot(state, event);
  }
  if (operation.operation === 'write') {
    const next = clone(state);
    const discarded = new Set(operation.invalidatedIds);
    next.currentIds = next.currentIds.filter((id) => !discarded.has(id));
    for (const node of next.nodes) {
      if (!discarded.has(node.id)) continue;
      node.status = 'void';
      node.voidedSeq = event.seq;
      node.voidedTime = event.time;
    }
    for (const task of operation.added) {
      next.nodes.push({
        id: task.id,
        content: task.content,
        status: 'pending',
        reports: [],
        createdSeq: event.seq,
        createdTime: event.time,
      });
      next.currentIds.push(task.id);
      rememberInTurn(next, task.id);
      const numericId = /^t(\d+)$/.exec(task.id);
      if (numericId) next.nextTaskNumber = Math.max(next.nextTaskNumber, Number(numericId[1]) + 1);
    }
    if (operation.mode === 'reorder') next.lastReportTaskId = null;
    return next;
  }
  if (operation.operation === 'start' || operation.operation === 'finish') {
    const next = clone(state);
    const task = next.nodes.find((node) => node.id === operation.taskId);
    if (!task) return state;
    task.status = operation.operation === 'start' ? 'in_progress' : 'completed';
    const callId = typeof operation.callId === 'string' ? operation.callId : state.lastToolCallId;
    if (operation.operation === 'start' && typeof callId === 'string') {
      task.startCallId = callId;
      task.startSeq = event.seq;
    }
    return next;
  }
  if (operation.operation === 'report') {
    const next = clone(state);
    const task = next.nodes.find((node) => node.id === operation.taskId);
    if (!task) return state;
    const callId = typeof operation.callId === 'string' ? operation.callId : state.lastToolCallId;
    task.reports.push({
      ...normalizeReport(operation.report),
      ...(typeof callId === 'string' ? { callId } : {}),
      seq: event.seq,
      time: event.time,
    });
    next.lastReportTaskId = operation.taskId;
    return next;
  }
  return state;
}

function issueNavigationFields(report) {
  if (typeof report.callId !== 'string' || typeof report.seq !== 'number') return {};
  return { startCallId: report.callId, startSeq: report.seq };
}

function issueSummaries(state, task, range) {
  const active = activeIssue(state, task.id);
  const summaries = new Map();
  let continued;
  for (const report of task.reports) {
    if (!report.inIssue) {
      continued = undefined;
      continue;
    }
    const name = report.issue ?? continued;
    if (typeof name !== 'string' || name.length === 0) {
      continued = undefined;
      continue;
    }
    continued = name;
    if (typeof report.seq !== 'number') continue;
    if (range && (report.seq < range.startSeq || (range.endSeq !== undefined && report.seq >= range.endSeq))) continue;
    let summary = summaries.get(name);
    if (!summary) {
      summary = { name, firstSeq: report.seq, lastSeq: report.seq, active: false };
      summaries.set(name, summary);
    }
    summary.lastSeq = report.seq;
    delete summary.startCallId;
    delete summary.startSeq;
    Object.assign(summary, issueNavigationFields(report));
    if (active?.name === name && active.seq === report.seq) summary.active = true;
  }
  return [...summaries.values()].sort((left, right) => left.firstSeq - right.firstSeq);
}

function navigationFields(task) {
  if (typeof task.startCallId !== 'string' || typeof task.startSeq !== 'number') return {};
  return { startCallId: task.startCallId, startSeq: task.startSeq };
}

function currentPlanView(state) {
  return state.currentIds.map((id, index) => {
    const task = nodeById(state, id);
    return {
      id,
      index: index + 1,
      content: task.content,
      status: task.status,
      ...navigationFields(task),
      issues: issueSummaries(state, task),
    };
  });
}

function historyTurnView(state, turn) {
  const tasks = turn.taskIds.map((id) => {
    const task = nodeById(state, id);
    if (!task) return undefined;
    return {
      id,
      content: task.content,
      status: turn.endStatuses?.[id] ?? task.status,
      ...navigationFields(task),
      issues: issueSummaries(state, task, turn),
    };
  }).filter(Boolean);
  return {
    turn: turn.turn,
    startSeq: turn.startSeq,
    ...(turn.endSeq === undefined ? {} : { endSeq: turn.endSeq }),
    open: turn.endStatuses === undefined,
    total: tasks.length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    voided: tasks.filter((task) => task.status === 'void').length,
    preview: tasks.slice(0, 2).map((task) => task.content).join('\u3000'),
    tasks,
  };
}

function computeLedgerView(state) {
  return {
    currentTurn: state.currentTurn,
    dock: dockTodos(state),
    current: currentPlanView(state),
    turns: state.turns.map((turn) => historyTurnView(state, turn)),
  };
}

// View memo. The key is the `state.nodes` array reference: every semantic fold
// (`todo/write`, `turn/start`, `turn/end`) deep-clones the state, so a new nodes
// array always means new node/report/turn contents, and no published state is
// mutated in place. Node contents are therefore a pure function of that array
// identity. The view also reads currentIds/turns/currentTurn/lastReportTaskId,
// so those are compared separately; it deliberately ignores lastToolCallId (a
// shallow `tool/call` copy must hit) and nextTaskNumber/version.
// A hit returns the exact same object so the projection registry can dedupe by
// Object.is without re-running Zod parsing or JSON serialization.
const ledgerViewCache = new WeakMap();

export function ledgerView(state) {
  const cached = ledgerViewCache.get(state.nodes);
  if (
    cached !== undefined
    && cached.currentIds === state.currentIds
    && cached.turns === state.turns
    && cached.currentTurn === state.currentTurn
    && cached.lastReportTaskId === state.lastReportTaskId
  ) {
    return cached.view;
  }
  const view = computeLedgerView(state);
  ledgerViewCache.set(state.nodes, {
    currentIds: state.currentIds,
    turns: state.turns,
    currentTurn: state.currentTurn,
    lastReportTaskId: state.lastReportTaskId,
    view,
  });
  return view;
}

export function defaultHistoryTurn(turns) {
  const nonEmpty = turns.filter((turn) => turn.total > 0);
  const archived = nonEmpty.filter((turn) => !turn.open);
  const candidates = archived.length > 0 ? archived : nonEmpty;
  return (candidates.at(-1) ?? turns.at(-1))?.turn;
}

export function adjacentTurn(turns, selectedTurn, offset) {
  const ordered = [...turns].sort((left, right) => left.turn - right.turn);
  const index = ordered.findIndex((turn) => turn.turn === selectedTurn);
  if (index < 0 || !Number.isInteger(offset)) return undefined;
  return ordered[index + offset]?.turn;
}

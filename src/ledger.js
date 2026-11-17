import { LEDGER_MESSAGES, fillPrompt } from './prompts.js';

export const LEDGER_VERSION = 1;

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
    currentTurn: 0,
    turns: [{ turn: 0, startSeq: 0, taskIds: [] }],
  };
}

function clone(value) {
  return structuredClone(value);
}

function nodeById(state, id) {
  return state.nodes.find((node) => node.id === id);
}

function openTurn(state) {
  return state.turns.find((entry) => entry.turn === state.currentTurn);
}

function rememberInTurn(state, taskId) {
  const turn = openTurn(state);
  // A closed turn is archived: writes between `turn/end` and the next
  // `turn/start` must wait for that next turn to pick them up.
  if (turn && !turn.endStatuses && !turn.taskIds.includes(taskId)) turn.taskIds.push(taskId);
}

function closeTurn(state, turn, seq) {
  if (!turn || turn.endStatuses) return;
  turn.endSeq = seq;
  turn.endStatuses = {};
  const issues = {};
  for (const id of turn.taskIds) {
    const task = state.nodes.find((node) => node.id === id);
    if (!task) continue;
    turn.endStatuses[id] = task.status;
    const summaries = issueSummaries(task.reports, { startSeq: turn.startSeq, endSeq: seq });
    if (summaries.length > 0) issues[id] = summaries;
  }
  if (Object.keys(issues).length > 0) turn.issues = issues;
  // Reports are only needed while their turn is open. Keep the last one of each
  // task so issue continuation and the active issue still resolve in later
  // turns; everything else lives on as the turn's issue summaries.
  for (const node of state.nodes) {
    if (node.reports.length > 1) node.reports = [node.reports.at(-1)];
  }
}

function openNextTurn(state, event) {
  const number = event.data?.turn;
  if (!Number.isInteger(number) || number <= state.currentTurn) return state;
  const next = clone(state);
  closeTurn(next, openTurn(next), event.seq);
  const taskIds = next.currentIds.filter((id) => {
    const task = next.nodes.find((node) => node.id === id);
    return task && (task.status === 'pending' || task.status === 'in_progress');
  });
  next.currentTurn = number;
  next.turns.push({ turn: number, startSeq: event.seq, taskIds });
  return next;
}

function closeCurrentTurn(state, event) {
  if (event.data?.turn !== state.currentTurn) return state;
  const turn = openTurn(state);
  if (!turn || turn.endStatuses) return state;
  const next = clone(state);
  closeTurn(next, openTurn(next), event.seq);
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

// Task numbers only ever grow: reorders void nodes instead of freeing their ids.
// Deriving the next number keeps the allocated sequence without persisting a
// counter that every write would have to clone and replay.
function nextTaskNumber(state) {
  let next = 1;
  for (const node of state.nodes) {
    const match = /^t(\d+)$/.exec(node.id);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}

function normalizeTasks(values) {
  if (!Array.isArray(values)) throw ledgerError('todosArray');
  const tasks = values.map(contentOf);
  const unique = new Set(tasks);
  if (unique.size !== tasks.length) throw ledgerError('taskUnique');
  return tasks;
}

function taskAt(state, index, toolName) {
  if (!Number.isInteger(index) || index < 1 || index > state.currentIds.length) {
    throw ledgerError('taskIndexRange', { tool: toolName, count: state.currentIds.length });
  }
  const id = state.currentIds[index - 1];
  const task = state.nodes.find((node) => node.id === id);
  if (!task) throw ledgerError('planInconsistent', { tool: toolName, index });
  return { id, task };
}

// The in-progress task with its current 1-based index, if the plan has one.
function inProgressEntry(state) {
  for (let index = 0; index < state.currentIds.length; index += 1) {
    const task = nodeById(state, state.currentIds[index]);
    if (task?.status === 'in_progress') return { index: index + 1, task };
  }
  return undefined;
}

function taskReference(entry) {
  return `${entry.index}「${entry.task.content}」`;
}

export function legacyTodos(state) {
  return state.currentIds.map((id) => {
    const task = nodeById(state, id);
    return { content: task.content, status: task.status };
  });
}

export function activeIssue(state, taskId) {
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
function applyWrite(state, rawTasks, reorderFrom) {
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
    }
  }

  const added = [];
  let nextId = nextTaskNumber(state);
  for (const content of tasks) {
    const id = `t${nextId}`;
    nextId += 1;
    state.nodes.push({
      id,
      content,
      status: 'pending',
      reports: [],
    });
    state.currentIds.push(id);
    rememberInTurn(state, id);
    added.push({ id, content });
  }
  if (reorder) state.lastReportTaskId = null;

  const numberedAdded = added.map((task) => ({
    index: state.currentIds.indexOf(task.id) + 1,
    ...task,
  }));
  return { mode: reorder ? 'reorder' : 'append', reorderFrom, added: numberedAdded, invalidated };
}

export function writeLedger(state, rawTasks, reorderFrom) {
  const next = clone(state);
  return { state: next, ...applyWrite(next, rawTasks, reorderFrom) };
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

export function updateLedger(state, args) {
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
    write = applyWrite(next, todos ?? [], reorderFrom);
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

/**
 * Whether `task` was completed by a finish in the model step that is still
 * current. Tool calls in one assistant step execute in model order, so a report
 * listed after its finish runs only once the task is already completed. The
 * report still describes that task's final work; call-list order is not
 * protocol-meaningful, so it is accepted instead of demanding a new target.
 * A report from any later step must still address the active task.
 */
function finishedInCurrentStep(state, task) {
  if (task.status !== 'completed') return false;
  if (!Number.isInteger(task.finishTurn) || !Number.isInteger(task.finishStep)) return false;
  return task.finishTurn === state.lastToolCallTurn && task.finishStep === state.lastToolCallStep;
}

export function reportLedger(state, index, inIssue, rawIssue) {
  const { id, task } = taskAt(state, index, 'todo_report');
  const lateFinish = finishedInCurrentStep(state, task);
  if (typeof inIssue !== 'boolean') throw ledgerError('inIssueBoolean');
  if (rawIssue !== undefined && (typeof rawIssue !== 'string' || rawIssue.trim().length === 0)) {
    throw ledgerError('issueString');
  }
  let issue = rawIssue?.trim();
  if (inIssue && issue === undefined) {
    // A late closing report may continue the issue it recorded before the
    // finish, even if another task received the latest report in between.
    const previous = lateFinish || state.lastReportTaskId === id ? task.reports.at(-1) : undefined;
    if (previous?.inIssue !== true || typeof previous.issue !== 'string') {
      throw ledgerError('issueRequired');
    }
    issue = previous.issue;
  }
  if (!inIssue && issue !== undefined) {
    throw ledgerError('issueOmitted');
  }
  if (task.status !== 'in_progress' && !lateFinish) {
    const active = inProgressEntry(state);
    throw active
      ? ledgerError('reportInactiveTask', { index, status: task.status, active: taskReference(active) })
      : ledgerError('reportNoActiveTask', { index, status: task.status });
  }
  // A late report closes out the task that finish just completed; it is not a
  // target switch, so the active task's continuation target must not block it.
  if (!lateFinish && state.lastReportTaskId !== null && state.lastReportTaskId !== id) {
    const previous = state.nodes.find((node) => node.id === state.lastReportTaskId);
    if (previous && previous.status !== 'completed') {
      const active = { index: state.currentIds.indexOf(previous.id) + 1, task: previous };
      throw ledgerError('reportSwitchBlocked', { active: taskReference(active) });
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
  let lastCompleted = -1;
  let firstNonCompleted = -1;
  for (let index = 0; index < state.currentIds.length; index += 1) {
    const task = nodeById(state, state.currentIds[index]);
    if (task.status === 'completed') {
      lastCompleted = index;
    } else if (firstNonCompleted < 0) {
      firstNonCompleted = index;
    }
  }
  // Older full-list snapshots may hold unfinished work before a completed task.
  // Starting at the last completion would hide that work, so in that case start
  // at the earliest unfinished task instead.
  const start = lastCompleted < 0
    ? 0
    : (firstNonCompleted < 0 ? lastCompleted : Math.min(lastCompleted, firstNonCompleted));
  const tasks = state.currentIds.slice(start).map((id, offset) => {
    const task = nodeById(state, id);
    const result = { index: start + offset + 1, content: task.content, status: task.status };
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
    // Shallow copy: the view ignores the tool-call fields, so the projection can
    // share nodes/currentIds/turns and reuse the cached view object. The step is
    // kept so a report that runs after its finish in the same model step can
    // still be attributed to the task that finish completed.
    return {
      ...state,
      lastToolCallId: event.data.callId,
      // Clear a previous step when this call cannot identify one; inheriting it
      // would let a finish look like it belongs to an older model step.
      lastToolCallTurn: Number.isInteger(event.data.turn) ? event.data.turn : undefined,
      lastToolCallStep: Number.isInteger(event.data.step) ? event.data.step : undefined,
    };
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
    }
    for (const task of operation.added) {
      next.nodes.push({
        id: task.id,
        content: task.content,
        status: 'pending',
        reports: [],
      });
      next.currentIds.push(task.id);
      rememberInTurn(next, task.id);
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
    if (operation.operation === 'finish') {
      // PTC sub-calls share the outer `run_code` tool call, so they inherit the
      // program's step and can scope a late report the same way.
      if (Number.isInteger(state.lastToolCallTurn) && Number.isInteger(state.lastToolCallStep)) {
        task.finishTurn = state.lastToolCallTurn;
        task.finishStep = state.lastToolCallStep;
      }
    }
    return next;
  }
  if (operation.operation === 'report') {
    const next = clone(state);
    const task = next.nodes.find((node) => node.id === operation.taskId);
    if (!task) return state;
    const callId = typeof operation.callId === 'string' ? operation.callId : state.lastToolCallId;
    const report = normalizeReport(operation.report);
    // Resolve a continued issue while the previous report is still at hand, so
    // archived summaries never need to look beyond the reports they cover.
    const previous = task.reports.at(-1);
    if (report.inIssue && report.issue === undefined && previous?.inIssue === true && typeof previous.issue === 'string') {
      report.issue = previous.issue;
    }
    task.reports.push({
      ...report,
      ...(typeof callId === 'string' ? { callId } : {}),
      seq: event.seq,
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

// Issue summaries for the reports inside `range`. Report names are resolved when
// a report is folded, so no summary depends on reports outside its range.
function issueSummaries(reports, range) {
  const summaries = new Map();
  for (const report of reports) {
    if (!report.inIssue) continue;
    const name = report.issue;
    if (typeof name !== 'string' || name.length === 0) continue;
    if (range && (report.seq < range.startSeq || (range.endSeq !== undefined && report.seq >= range.endSeq))) continue;
    let summary = summaries.get(name);
    if (!summary) {
      summary = { name, firstSeq: report.seq, lastSeq: report.seq };
      summaries.set(name, summary);
    }
    summary.lastSeq = report.seq;
    delete summary.startCallId;
    delete summary.startSeq;
    Object.assign(summary, issueNavigationFields(report));
  }
  return [...summaries.values()].sort((left, right) => left.firstSeq - right.firstSeq);
}

// `active` describes the current plan, not the archived turn, so it is computed
// while building the view instead of being frozen when the turn closes.
function withActive(summary, active) {
  return { ...summary, active: active?.name === summary.name && active.seq === summary.lastSeq };
}

// Summaries for one task inside one turn: the open turn reads its reports, a
// closed turn reads the summaries archived when it ended.
function turnSummaries(task, turn) {
  return turn.endStatuses === undefined
    ? issueSummaries(task.reports, { startSeq: turn.startSeq })
    : turn.issues?.[task.id] ?? [];
}

function turnIssues(state, task, turn) {
  const active = activeIssue(state, task.id);
  return turnSummaries(task, turn).map((summary) => withActive(summary, active));
}

function navigationFields(task, beforeSeq) {
  if (typeof task.startCallId !== 'string' || typeof task.startSeq !== 'number') return {};
  // Archived turns only expose starts that happened before the turn closed;
  // the task node itself keeps the latest start for current-plan navigation.
  if (typeof beforeSeq === 'number' && task.startSeq >= beforeSeq) return {};
  return { startCallId: task.startCallId, startSeq: task.startSeq };
}

function currentPlanView(state) {
  const turn = openTurn(state);
  return state.currentIds.map((id, index) => {
    const task = nodeById(state, id);
    const active = activeIssue(state, task.id);
    const summaries = turn === undefined ? [] : turnSummaries(task, turn);
    return {
      id,
      index: index + 1,
      content: task.content,
      status: task.status,
      ...navigationFields(task),
      issues: summaries.map((summary) => withActive(summary, active)),
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
      ...navigationFields(task, turn.endSeq),
      issues: turnIssues(state, task, turn),
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
// shallow `tool/call` copy must hit) and version.
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

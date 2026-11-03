export const LEDGER_VERSION = 1;
export const TODO_STATUSES = ['pending', 'in_progress', 'completed'];

export function emptyLedger() {
  return {
    version: LEDGER_VERSION,
    nodes: [],
    currentIds: [],
    lastReportTaskId: null,
    lastToolCallId: null,
    nextTaskNumber: 1,
  };
}

function clone(value) {
  return structuredClone(value);
}

function contentOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('todo_write: every task must be a non-empty string');
  }
  return value.trim();
}

export function normalizeTasks(values) {
  if (!Array.isArray(values)) throw new Error('todo_write: `todos` must be an array');
  const tasks = values.map(contentOf);
  const unique = new Set(tasks);
  if (unique.size !== tasks.length) throw new Error('todo_write: new task descriptions must be unique');
  return tasks;
}

export function taskAt(state, index, toolName) {
  if (!Number.isInteger(index) || index < 1 || index > state.currentIds.length) {
    throw new Error(`${toolName}: task index must be between 1 and ${state.currentIds.length}`);
  }
  const id = state.currentIds[index - 1];
  const task = state.nodes.find((node) => node.id === id);
  if (!task) throw new Error(`${toolName}: current plan is inconsistent at task ${index}`);
  return { id, task };
}

export function legacyTodos(state) {
  return state.currentIds.map((id) => {
    const task = state.nodes.find((node) => node.id === id);
    return { content: task.content, status: task.status };
  });
}

export function dockTodos(state) {
  return state.currentIds.map((id) => {
    const task = state.nodes.find((node) => node.id === id);
    const result = { content: task.content, status: task.status };
    if (typeof task.startCallId === 'string' && typeof task.startSeq === 'number') {
      result.startCallId = task.startCallId;
      result.startSeq = task.startSeq;
    }
    if (task.status === 'in_progress' && state.lastReportTaskId === id) {
      const latest = task.reports.at(-1);
      if (latest?.inLocalTask && latest.localTask) result.localTask = latest.localTask;
    }
    return result;
  });
}

export function writeLedger(state, rawTasks, start, meta = { seq: 0, time: 0 }) {
  const tasks = normalizeTasks(rawTasks);
  const reorder = start !== undefined;
  if (!reorder && tasks.length === 0) throw new Error('todo_write: append requires at least one task');
  if (reorder && (!Number.isInteger(start) || start < 1 || start > state.currentIds.length)) {
    throw new Error(`todo_write: start must be an existing 1-based task index (1-${state.currentIds.length})`);
  }

  const next = clone(state);
  const invalidatedIds = [];
  const invalidated = [];
  if (reorder) {
    for (let index = start - 1; index < state.currentIds.length; index += 1) {
      const id = state.currentIds[index];
      const oldTask = state.nodes.find((node) => node.id === id);
      if (oldTask.status === 'completed') continue;
      invalidatedIds.push(id);
      invalidated.push({ oldIndex: index + 1, id, content: oldTask.content, status: oldTask.status });
    }
    if (invalidatedIds.length === 0 && tasks.length === 0) {
      throw new Error('todo_write: this reorder would not change the plan');
    }
    const discarded = new Set(invalidatedIds);
    next.currentIds = next.currentIds.filter((id) => !discarded.has(id));
    for (const node of next.nodes) {
      if (!discarded.has(node.id)) continue;
      node.status = 'void';
      node.voidedSeq = meta.seq;
      node.voidedTime = meta.time;
    }
  }

  const added = [];
  for (const content of tasks) {
    const id = `t${next.nextTaskNumber}`;
    next.nextTaskNumber += 1;
    next.nodes.push({
      id,
      content,
      status: 'pending',
      reports: [],
      createdSeq: meta.seq,
      createdTime: meta.time,
    });
    next.currentIds.push(id);
    added.push({ id, content });
  }
  if (reorder) next.lastReportTaskId = null;

  const numberedAdded = added.map((task) => ({
    index: next.currentIds.indexOf(task.id) + 1,
    ...task,
  }));
  return { state: next, mode: reorder ? 'reorder' : 'append', start, added: numberedAdded, invalidated };
}

export function startLedger(state, index) {
  const { id, task } = taskAt(state, index, 'todo_start');
  if (task.status !== 'pending') throw new Error(`todo_start: task ${index} is ${task.status}, not pending`);
  for (let previous = 0; previous < index - 1; previous += 1) {
    const previousTask = state.nodes.find((node) => node.id === state.currentIds[previous]);
    if (previousTask.status !== 'completed') {
      throw new Error(`todo_start: finish earlier task ${previous + 1} before starting task ${index}`);
    }
  }
  const next = clone(state);
  next.nodes.find((node) => node.id === id).status = 'in_progress';
  return { state: next, taskId: id };
}

export function finishLedger(state, index) {
  const { id, task } = taskAt(state, index, 'todo_finish');
  if (task.status !== 'in_progress') {
    throw new Error(`todo_finish: task ${index} is ${task.status}, not in_progress`);
  }
  const next = clone(state);
  next.nodes.find((node) => node.id === id).status = 'completed';
  return { state: next, taskId: id };
}

export function reportLedger(state, index, inLocalTask, rawLocalTask) {
  const { id, task } = taskAt(state, index, 'todo_report');
  if (typeof inLocalTask !== 'boolean') throw new Error('todo_report: `inLocalTask` must be a boolean');
  if (rawLocalTask !== undefined && (typeof rawLocalTask !== 'string' || rawLocalTask.trim().length === 0)) {
    throw new Error('todo_report: `localTask` must be a non-empty string');
  }
  let localTask = rawLocalTask?.trim();
  if (inLocalTask && localTask === undefined) {
    const previous = state.lastReportTaskId === id ? task.reports.at(-1) : undefined;
    if (previous?.inLocalTask !== true || typeof previous.localTask !== 'string') {
      throw new Error('todo_report: `localTask` is required when entering a local task');
    }
    localTask = previous.localTask;
  }
  if (!inLocalTask && localTask !== undefined) {
    throw new Error('todo_report: omit `localTask` when `inLocalTask` is false');
  }
  if (task.status !== 'in_progress') {
    throw new Error(`todo_report: task ${index} is ${task.status}, start it before reporting work`);
  }
  if (state.lastReportTaskId !== null && state.lastReportTaskId !== id) {
    const previous = state.nodes.find((node) => node.id === state.lastReportTaskId);
    if (previous && previous.status !== 'completed') {
      throw new Error('todo_report: finish the previous task before switching goals, or explicitly reorder the plan');
    }
  }
  const report = { index, inLocalTask, ...(localTask === undefined ? {} : { localTask }) };
  const next = clone(state);
  next.nodes.find((node) => node.id === id).reports.push(report);
  next.lastReportTaskId = id;
  return { state: next, taskId: id, report };
}

export function numberedPlan(state) {
  return state.currentIds.map((id, index) => {
    const task = state.nodes.find((node) => node.id === id);
    return { index: index + 1, content: task.content, status: task.status };
  });
}

export function currentView(state) {
  let first = 0;
  for (let index = 0; index < state.currentIds.length; index += 1) {
    const task = state.nodes.find((node) => node.id === state.currentIds[index]);
    if (task.status === 'completed') first = index;
  }
  const tasks = state.currentIds.slice(first).map((id, offset) => {
    const task = state.nodes.find((node) => node.id === id);
    const result = { index: first + offset + 1, content: task.content, status: task.status };
    if (task.status === 'in_progress' && state.lastReportTaskId === id && task.reports.length > 0) {
      const latest = task.reports.at(-1);
      if (latest.inLocalTask) result.localTask = latest.localTask;
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
  next.lastReportTaskId = null;
  return next;
}

export function foldLedgerEvent(state, event) {
  if (event.type === 'tool/call' && typeof event.data?.callId === 'string') {
    const next = clone(state);
    next.lastToolCallId = event.data.callId;
    return next;
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
    task.reports.push({
      ...operation.report,
      seq: event.seq,
      time: event.time,
    });
    next.lastReportTaskId = operation.taskId;
    return next;
  }
  return state;
}

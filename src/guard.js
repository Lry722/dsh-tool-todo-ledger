const EXEMPT_TOOLS = new Set(['todo_write', 'todo_read', 'todo_report']);

function blocked(reason) {
  return `Blocked: ${reason}`;
}

export function stepToolCalls(message) {
  return message?.content?.filter((block) => block.type === 'tool-call') ?? [];
}

export function inProgressTask(state) {
  if (!state || !Array.isArray(state.currentIds)) return undefined;
  for (const id of state.currentIds) {
    const task = state.nodes?.find((node) => node.id === id);
    if (task?.status === 'in_progress') return task;
  }
  return undefined;
}

function reportRecorded(task, callId) {
  return task.reports?.at(-1)?.callId === callId;
}

/**
 * Decide whether one tool execution is covered by the current todo plan.
 * A work step needs an in-progress main task and exactly one successful
 * todo_report issued before any other tool call in the same assistant message.
 * @param state - the current `todoLedger` projection.
 * @param message - the assistant message that requested this step's tool calls.
 * @param execution - the execution being guarded; `rootCallId` identifies the
 *   model-requested call even for a nested PTC sub-dispatch.
 * @returns a model-facing denial reason, or undefined when the call may run.
 */
export function stepViolation(state, message, execution) {
  const calls = stepToolCalls(message);
  const root = calls.find((call) => call.id === execution.rootCallId);
  if (!root) return blocked('this call could not be matched to the assistant step that requested it. Retry the step.');

  const reports = calls.filter((call) => call.name === 'todo_report');
  const rootIndex = calls.indexOf(root);

  if (root.name === 'todo_report') {
    if (reports.length !== 1) return blocked('a step may call todo_report exactly once.');
    const firstWork = calls.findIndex((call) => !EXEMPT_TOOLS.has(call.name));
    if (firstWork !== -1 && firstWork < rootIndex) {
      return blocked('todo_report must precede the other tool calls in the same step.');
    }
    return undefined;
  }

  if (EXEMPT_TOOLS.has(root.name)) return undefined;

  const task = inProgressTask(state);
  if (!task) {
    return blocked('no main task is in progress. Create and start one, then retry this step with todo_report before the other tool calls.');
  }
  if (reports.length === 0) {
    return blocked('this step calls other tools without todo_report. Retry with exactly one todo_report before the other tool calls.');
  }
  if (reports.length !== 1) return blocked('a step may call todo_report exactly once.');

  const report = reports[0];
  if (calls.indexOf(report) > rootIndex) {
    return blocked('todo_report must precede the other tool calls in the same step.');
  }
  if (!reportRecorded(task, String(report.id))) {
    return blocked('the todo_report in this step did not record a report. Fix its index and inIssue, then retry before the other tool calls.');
  }
  return undefined;
}

/**
 * Remember the latest assistant message per session so a later tool guard can
 * inspect the complete step, including calls that have not run yet.
 * @param ctx - the plugin context carrying session events.
 * @returns a lookup used by the per-agent guard.
 */
export function installStepTracker(ctx) {
  const steps = new Map();
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message' || event.data?.interrupted) return;
    const message = event.data?.message;
    if (!message?.content) return;
    steps.set(String(session.id), message);
  });
  ctx.on('session/disposed', (session) => {
    steps.delete(String(session.id));
  });
  return (session) => steps.get(String(session.id));
}

/**
 * Register the monotonic guard that rejects uncovered tool calls for one agent.
 * Guards sit after the extensible pre-execute policy, so no other plugin can
 * turn this denial back into permission.
 * @param ctx - plugin context providing the ledger projection.
 * @param agent - the agent whose tool calls are guarded.
 * @param stepOf - latest assistant-message lookup from {@link installStepTracker}.
 * @returns the exact guard disposer.
 */
export function installReportGuard(ctx, agent, stepOf) {
  return agent.ctx.tools.guard((execution) => {
    if (!execution.agent) return undefined;
    try {
      const state = ctx.sessionProjections.stateOf(execution.agent.session, 'todoLedger');
      return stepViolation(state, stepOf(execution.agent.session), execution);
    } catch {
      return blocked('this step could not be verified against the todo plan. Retry after the todo state is available.');
    }
  });
}

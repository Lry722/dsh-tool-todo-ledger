import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { GUARD_MESSAGES, fillPrompt } from './prompts.js';

const EXEMPT_TOOLS = new Set(['todo_write', 'todo_read', 'todo_report']);
const INITIAL_COVERAGE_BUDGET = 3;

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

function latestReport(state) {
  let latest;
  for (const node of state?.nodes ?? []) {
    for (const report of node.reports ?? []) {
      const order = typeof report.seq === 'number' ? report.seq : report.time ?? 0;
      const latestOrder = typeof latest?.seq === 'number' ? latest.seq : latest?.time ?? 0;
      if (latest === undefined || order > latestOrder) latest = report;
    }
  }
  return latest;
}

/**
 * Create the violation budget that makes coverage checks lenient before they
 * become strict. Each warning round grants one exempt step per remaining budget
 * unit; a successful report resets the budget.
 * @param initial - exempt steps granted by the first warning round.
 * @returns the mutable budget.
 */
export function createCoverageBudget(initial = INITIAL_COVERAGE_BUDGET) {
  let budget = initial;
  let remaining = 0;
  let roundStarted = false;
  return {
    reset() {
      budget = initial;
      remaining = 0;
      roundStarted = false;
    },
    admit() {
      if (remaining > 0) {
        remaining -= 1;
        return { allowed: true };
      }
      if (budget <= 0) return { allowed: false };
      if (roundStarted) {
        budget -= 1;
        if (budget <= 0) return { allowed: false };
      }
      roundStarted = true;
      const granted = budget;
      remaining = Math.max(0, granted - 1);
      const template = granted === 1 ? GUARD_MESSAGES.coverageWarning.one : GUARD_MESSAGES.coverageWarning.many;
      return {
        allowed: true,
        warning: fillPrompt(template, { granted, remaining }),
      };
    },
  };
}

/**
 * Classify one tool execution against the current todo plan.
 * A work step needs an in-progress main task and one successful `todo_report`
 * issued before the other tool calls. Missing or failed reports are exemptible;
 * malformed steps and plans without an active task remain hard violations.
 * @param state - the current `todoLedger` projection.
 * @param message - the assistant message that requested this step's tool calls.
 * @param execution - the execution being guarded; `rootCallId` identifies the
 *   model-requested call even for a nested PTC sub-dispatch.
 * @returns the coverage classification for the execution.
 */
export function stepCoverage(state, message, execution) {
  const calls = stepToolCalls(message);
  const root = calls.find((call) => call.id === execution.rootCallId);
  // Calls outside the tracked assistant step cannot be model actions; leave them unguarded.
  if (!root) return { outcome: 'exempt' };

  const reports = calls.filter((call) => call.name === 'todo_report');
  const rootIndex = calls.indexOf(root);

  if (root.name === 'todo_report') {
    if (reports.length !== 1) return { outcome: 'blocked', reason: GUARD_MESSAGES.duplicateReport };
    const firstWork = calls.findIndex((call) => !EXEMPT_TOOLS.has(call.name));
    if (firstWork !== -1 && firstWork < rootIndex) {
      return { outcome: 'blocked', reason: GUARD_MESSAGES.lateReport };
    }
    return { outcome: 'exempt' };
  }

  if (EXEMPT_TOOLS.has(root.name)) return { outcome: 'exempt' };

  const task = inProgressTask(state);
  if (!task) {
    return { outcome: 'blocked', reason: GUARD_MESSAGES.noActiveTask };
  }
  if (reports.length > 1) return { outcome: 'blocked', reason: GUARD_MESSAGES.duplicateReport };
  if (reports.length === 0) return { outcome: 'uncovered', coverage: 'missing' };
  if (calls.indexOf(reports[0]) > rootIndex) {
    return { outcome: 'blocked', reason: GUARD_MESSAGES.lateReport };
  }
  if (!reportRecorded(task, String(reports[0].id))) return { outcome: 'uncovered', coverage: 'failed' };
  return { outcome: 'covered' };
}

function steerCoverageWarning(agent, text) {
  if (typeof agent?.steer !== 'function') return;
  try {
    agent.steer(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'todo-ledger' },
    }));
  } catch (_error) {
    return;
  }
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
 * Each uncovered step consumes the exemption budget; a successful report resets
 * it, and only an exhausted budget becomes a hard denial.
 * @param ctx - plugin context providing the ledger projection.
 * @param agent - the agent whose tool calls are guarded.
 * @param stepOf - latest assistant-message lookup from {@link installStepTracker}.
 * @param budget - coverage budget state, shared by all calls of this agent.
 * @returns the exact guard disposer.
 */
export function installReportGuard(ctx, agent, stepOf, budget = createCoverageBudget()) {
  let observedMessage;
  let hasObserved = false;
  let observedDecision;
  let lastReportToken;

  function decide(state, coverage, guardedAgent) {
    const latest = latestReport(state);
    const latestToken = latest?.callId ?? latest?.seq;
    if (latestToken !== undefined && latestToken !== lastReportToken) {
      lastReportToken = latestToken;
      budget.reset();
    }
    if (coverage.outcome === 'blocked') return coverage.reason;
    if (coverage.outcome === 'covered') return undefined;
    const admission = budget.admit();
    if (!admission.allowed) {
      return GUARD_MESSAGES.budgetExhausted;
    }
    if (coverage.coverage === 'missing' && admission.warning !== undefined) steerCoverageWarning(guardedAgent, admission.warning);
    return undefined;
  }

  return agent.ctx.tools.guard((execution) => {
    if (!execution.agent) return undefined;
    try {
      const state = ctx.sessionProjections.stateOf(execution.agent.session, 'todoLedger');
      const message = stepOf(execution.agent.session);
      if (!hasObserved || observedMessage !== message) {
        const coverage = stepCoverage(state, message, execution);
        if (coverage.outcome === 'exempt') return undefined;
        observedMessage = message;
        hasObserved = true;
        observedDecision = decide(state, coverage, execution.agent);
      }
      return observedDecision;
    } catch {
      return GUARD_MESSAGES.verificationUnavailable;
    }
  });
}

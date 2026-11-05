import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { GUARD_MESSAGES, NOTICES, fillPrompt } from './prompts.js';

const EXEMPT_TOOLS = new Set(['todo_write', 'todo_read', 'todo_report']);
// A report may accompany plan writes, but reads and other reports are not work.
const NON_WORK_TOOLS = new Set(['todo_read', 'todo_report']);
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
 *
 * Warnings only demand the missing report; they never disclose how much of the
 * allowance is left, because knowing the slack invites spending it instead of
 * reporting immediately.
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
      remaining = budget - 1;
      const template = budget === 1 ? GUARD_MESSAGES.coverageWarning.one : GUARD_MESSAGES.coverageWarning.many;
      return { allowed: true, warning: template };
    },
  };
}

/**
 * Classify one tool execution against the current todo plan.
 * A work step needs an in-progress main task and a `todo_report` somewhere in
 * the same assistant message. Report position and count are tolerated: a report
 * that appears after the guarded action has not run yet, so the action is
 * admitted provisionally and later steps judge whether it was recorded. A report
 * without any action tool is still rejected; missing or failed reports are
 * exemptible, and plans without an active task stay hard violations.
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

  if (EXEMPT_TOOLS.has(root.name)) {
    // A report must accompany real work; reporting alone only doubles requests.
    if (root.name === 'todo_report' && !calls.some((call) => !NON_WORK_TOOLS.has(call.name))) {
      return { outcome: 'blocked', reason: GUARD_MESSAGES.standaloneReport };
    }
    return { outcome: 'exempt' };
  }

  const task = inProgressTask(state);
  if (!task) {
    return { outcome: 'blocked', reason: GUARD_MESSAGES.noActiveTask };
  }

  const reports = calls.filter((call) => call.name === 'todo_report');
  if (reports.length === 0) return { outcome: 'uncovered', coverage: 'missing' };
  if (reports.some((report) => reportRecorded(task, String(report.id)))) {
    return { outcome: 'covered' };
  }

  const rootIndex = calls.indexOf(root);
  // A report later in the same message cannot be recorded yet; let the action run
  // and verify the report in the following step instead of rejecting the whole step.
  if (reports.some((report) => calls.indexOf(report) > rootIndex)) {
    return { outcome: 'provisional' };
  }
  return { outcome: 'uncovered', coverage: 'failed' };
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

function reportGuardFailure(ctx, agent, error) {
  const text = fillPrompt(NOTICES.guardFailure, {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'todo-ledger',
        form: 'notice',
        summary: NOTICES.guardFailureSummary,
      },
    }));
  } catch (_error) {
    // The log entry below remains the fallback when injection is unavailable.
  }
  ctx.logger?.error(text);
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
  let failureReported = false;

  function decide(state, coverage, guardedAgent) {
    const latest = latestReport(state);
    const latestToken = latest?.callId ?? latest?.seq;
    if (latestToken !== undefined && latestToken !== lastReportToken) {
      lastReportToken = latestToken;
      budget.reset();
    }
    if (coverage.outcome === 'blocked') return coverage.reason;
    if (coverage.outcome === 'covered' || coverage.outcome === 'provisional') return undefined;
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
      // Reports never inherit a decision cached for another call in the same
      // message; only the step structure decides whether a report may run.
      if (execution.name === 'todo_report') {
        const coverage = stepCoverage(state, message, execution);
        return coverage.outcome === 'blocked' ? coverage.reason : undefined;
      }
      if (!hasObserved || observedMessage !== message) {
        const coverage = stepCoverage(state, message, execution);
        if (coverage.outcome === 'exempt') {
          failureReported = false;
          return undefined;
        }
        observedMessage = message;
        hasObserved = true;
        observedDecision = decide(state, coverage, execution.agent);
      }
      failureReported = false;
      return observedDecision;
    } catch (error) {
      if (!failureReported) {
        failureReported = true;
        try {
          reportGuardFailure(ctx, agent, error);
        } catch (_error) {
          // Reporting is best-effort; the tool call must still proceed.
        }
      }
      return undefined;
    }
  });
}

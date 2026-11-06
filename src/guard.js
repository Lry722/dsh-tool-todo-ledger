import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools';
import { GUARD_MESSAGES, NOTICES, fillPrompt } from './prompts.js';

const EXEMPT_TOOLS = new Set(['todo_write', 'todo_read', 'todo_report']);
const INITIAL_COVERAGE_BUDGET = 3;
const PTC_DISPATCH_MARKER = ':ptc:';

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

function issueName(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Whether a `todo_report` restates the issue it is continuing instead of
 * omitting the optional name. Continuation needs no name, so repeating the
 * active one only spends context; the guard steers once and still admits the
 * report. Trimmed equality keeps harmless whitespace from hiding a repeat.
 * @param state - the current `todoLedger` projection.
 * @param execution - the report execution whose parsed arguments are inspected.
 * @returns the repeated task and issue name, or undefined.
 */
export function repeatedIssue(state, execution) {
  const args = execution?.arguments;
  if (args === null || typeof args !== 'object' || args.inIssue !== true) return undefined;
  const issue = issueName(args.issue);
  if (issue === undefined) return undefined;
  const task = inProgressTask(state);
  // A reorder keeps an in-progress task but clears the continuation target, so
  // its next issue must be named even when the name matches an older report.
  if (state.lastReportTaskId !== task?.id) return undefined;
  const previous = task.reports.at(-1);
  if (previous?.inIssue !== true) return undefined;
  if (issueName(previous.issue) !== issue) return undefined;
  return { taskId: task.id, issue };
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
 * Whether an execution is a nested PTC dispatch rather than the model-visible
 * call itself. PTC sub-call ids are derived from the outer `run_code` call id.
 * @param execution - the tool execution being classified.
 * @returns true for a PTC sub-dispatch.
 */
export function isPtcDispatch(execution) {
  const callId = String(execution?.callId ?? '');
  const rootCallId = String(execution?.rootCallId ?? '');
  return callId !== rootCallId
    && rootCallId.length > 0
    && callId.startsWith(`${rootCallId}${PTC_DISPATCH_MARKER}`);
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

  // A PTC sub-dispatch is one call inside a `run_code` program. Todo tools stay
  // exempt so a program can bootstrap an empty ledger; actions need an active
  // task, while report coverage is judged once per program after it finishes
  // (there is no message-level call list to look ahead into).
  if (isPtcDispatch(execution)) {
    if (EXEMPT_TOOLS.has(execution.name)) return { outcome: 'exempt' };
    if (!inProgressTask(state)) return { outcome: 'blocked', reason: GUARD_MESSAGES.noActiveTask };
    return { outcome: 'provisional' };
  }

  // The outer program is judged by its nested dispatches, not by the container
  // call: requiring an active task here would make an empty ledger impossible
  // to bootstrap because PTC mode denies direct todo tool calls.
  if (root.name === RUN_CODE_NAME) return { outcome: 'exempt' };

  if (EXEMPT_TOOLS.has(root.name)) {
    // A report must accompany any other tool; reporting alone only doubles requests.
    if (root.name === 'todo_report' && !calls.some((call) => call.name !== 'todo_report')) {
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

/**
 * Deliver one steer when the agent accepts it.
 * @returns whether the steer was accepted, so callers can retry transient
 *   failures instead of treating them as delivered.
 */
function steerAgent(agent, text) {
  if (typeof agent?.steer !== 'function') return false;
  try {
    agent.steer(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'todo-ledger' },
    }));
    return true;
  } catch (_error) {
    return false;
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
  let messageAdmission;
  let lastReportToken;
  let repeatedIssueSteered;
  let failureReported = false;
  // PTC programs have no message-level call list, so coverage is judged once
  // per program after its nested dispatches settle.
  const ptcPrograms = new Map();
  let ptcPendingReport = false;

  function decide(message, state, coverage, guardedAgent) {
    const latest = latestReport(state);
    const latestToken = latest?.callId ?? latest?.seq;
    if (latestToken !== undefined && latestToken !== lastReportToken) {
      lastReportToken = latestToken;
      budget.reset();
    }
    // Hard blocks and recorded/pending reports never depend on the budget or
    // on an earlier admission cached for this message.
    if (coverage.outcome === 'blocked') return coverage.reason;
    if (coverage.outcome === 'covered' || coverage.outcome === 'provisional') return undefined;
    // An assistant message may spend at most one admission. Later uncovered
    // actions reuse it, including a denial, without steering again.
    if (observedMessage !== message) {
      observedMessage = message;
      messageAdmission = budget.admit();
      if (coverage.coverage === 'missing' && messageAdmission.warning !== undefined) {
        steerAgent(guardedAgent, messageAdmission.warning);
      }
    }
    if (!messageAdmission.allowed) {
      return GUARD_MESSAGES.budgetExhausted;
    }
    return undefined;
  }

  function steerRepeatedIssue(state, execution, guardedAgent) {
    const repeated = repeatedIssue(state, execution);
    if (repeated === undefined) {
      repeatedIssueSteered = undefined;
      return;
    }
    // One steer per issue streak is enough; a compliant report (one that omits
    // the name) clears the marker so a later relapse is corrected again.
    if (
      repeatedIssueSteered?.taskId === repeated.taskId
      && repeatedIssueSteered.issue === repeated.issue
    ) return;
    const text = fillPrompt(GUARD_MESSAGES.repeatedIssue, { issue: repeated.issue });
    // Record the correction only after the steer is delivered; a transient
    // failure must not suppress the reminder for the rest of the issue streak.
    if (steerAgent(execution.agent ?? guardedAgent, text)) repeatedIssueSteered = repeated;
  }

  /**
   * Fold the PTC dispatch trail into a per-program coverage record. Dispatch
   * events settle before the outer `run_code` result, so the result event is
   * the program boundary.
   */
  const trackPtcProgram = (session, event) => {
    if (session !== agent.session) return;
    try {
      if (event.type === 'session/disposed') {
        ptcPrograms.clear();
        return;
      }
      if (event.type === 'tool/call' && event.data?.name === RUN_CODE_NAME) {
        // A new program supersedes a record whose result never arrived.
        ptcPrograms.clear();
        return;
      }
      if (event.type === 'tool/ptc-dispatch') {
        const parentCallId = event.data?.parentCallId;
        if (typeof parentCallId !== 'string') return;
        const record = ptcPrograms.get(parentCallId) ?? { hadAction: false, reported: false };
        if (event.data?.name === 'todo_report') {
          if (event.data?.isError !== true) {
            record.reported = true;
            ptcPendingReport = false;
            budget.reset();
          }
        } else if (!EXEMPT_TOOLS.has(event.data?.name)) {
          record.hadAction = true;
        }
        ptcPrograms.set(parentCallId, record);
        return;
      }
      if (event.type !== 'tool/result') return;
      const callId = event.data?.message?.callId;
      if (typeof callId !== 'string') return;
      const record = ptcPrograms.get(callId);
      if (!record) return;
      ptcPrograms.delete(callId);
      if (!record.hadAction || record.reported) return;
      const admission = budget.admit();
      if (!admission.allowed) {
        ptcPendingReport = true;
        steerAgent(agent, GUARD_MESSAGES.ptcPendingReport);
      } else if (admission.warning !== undefined) {
        steerAgent(agent, admission.warning);
      }
    } catch (_error) {
      // Observation is best-effort; the guard must not fail a tool call.
    }
  };

  const disposePtcTracking = ctx.on('session/event', trackPtcProgram);
  const disposeGuard = agent.ctx.tools.guard((execution) => {
    if (!execution.agent) return undefined;
    try {
      if (isPtcDispatch(execution) && !EXEMPT_TOOLS.has(execution.name) && ptcPendingReport) {
        return GUARD_MESSAGES.ptcPendingReport;
      }
      const state = ctx.sessionProjections.stateOf(execution.agent.session, 'todoLedger');
      const message = stepOf(execution.agent.session);
      // Reports never inherit a decision cached for another call in the same
      // message; only the step structure decides whether a report may run.
      if (execution.name === 'todo_report') {
        const coverage = stepCoverage(state, message, execution);
        if (coverage.outcome === 'blocked') return coverage.reason;
        steerRepeatedIssue(state, execution, execution.agent);
        return undefined;
      }
      // Every action re-reads the current state: an earlier todo_write in the
      // same message may finish the task or switch the active one.
      const coverage = stepCoverage(state, message, execution);
      if (coverage.outcome === 'exempt') {
        failureReported = false;
        return undefined;
      }
      const decision = decide(message, state, coverage, execution.agent);
      failureReported = false;
      return decision;
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
  return () => {
    disposeGuard?.();
    disposePtcTracking?.();
  };
}

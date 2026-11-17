import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools';
import { GUARD_MESSAGES, NOTICES, fillPrompt } from './prompts.js';
import { callArguments, callPosition, stepToolCalls } from './step.js';

const EXEMPT_TOOLS = new Set(['todo_write', 'todo_read', 'todo_report']);
const INITIAL_COVERAGE_BUDGET = 3;
const PTC_DISPATCH_MARKER = ':ptc:';

/**
 * Task ids addressed by `todo_report` calls in this assistant step. With an
 * `afterCallId`, only calls listed after it are considered: such a report has
 * not run yet, so a finish can look forward to it. Reports that already ran are
 * judged by the ledger instead, because they may have failed. A `reorderFrom`
 * between the boundary and a report rebases the later indices, so that report
 * is not counted against the pre-reorder plan.
 * @param state - the current `todoLedger` projection.
 * @param message - the assistant message that requested this step's tool calls.
 * @param afterCallId - optional call id that bounds the look-ahead.
 * @returns the set of targeted task ids.
 */
export function stepReportTargets(state, message, afterCallId) {
  const targets = new Set();
  if (!Array.isArray(state?.currentIds)) return targets;
  const calls = stepToolCalls(message);
  let start = 0;
  if (afterCallId !== undefined) {
    const boundary = callPosition(calls, afterCallId);
    if (boundary < 0) return targets;
    start = boundary + 1;
  }
  for (const call of calls.slice(start)) {
    if (call.name === 'todo_write') {
      if (callArguments(call)?.reorderFrom !== undefined) break;
      continue;
    }
    if (call.name !== 'todo_report') continue;
    const index = callArguments(call)?.index;
    if (!Number.isInteger(index) || index < 1 || index > state.currentIds.length) continue;
    targets.add(state.currentIds[index - 1]);
  }
  return targets;
}

export function inProgressTask(state) {
  if (!state || !Array.isArray(state.currentIds)) return undefined;
  for (const id of state.currentIds) {
    const task = state.nodes?.find((node) => node.id === id);
    if (task?.status === 'in_progress') return task;
  }
  return undefined;
}

// The active task numbered the way `todo_report` addresses it, so a block can
// name the right index instead of only complaining about the missing reports.
function activeTaskReference(state) {
  const task = inProgressTask(state);
  if (!task) return undefined;
  return `${state.currentIds.indexOf(task.id) + 1}「${task.content}」`;
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
  // Judge the task the report names, not whichever task is active now: a report
  // may close out the task that a finish in the same step just completed.
  const index = args.index;
  const reported = Number.isInteger(index) && index >= 1 && index <= (state?.currentIds?.length ?? 0)
    ? state.nodes?.find((node) => node.id === state.currentIds[index - 1])
    : inProgressTask(state);
  // A reorder keeps an in-progress task but clears the continuation target, so
  // its next issue must be named even when the name matches an older report.
  if (!reported || state.lastReportTaskId !== reported.id) return undefined;
  const previous = reported.reports.at(-1);
  if (previous?.inIssue !== true) return undefined;
  if (issueName(previous.issue) !== issue) return undefined;
  return { taskId: reported.id, issue };
}

/**
 * Detect a `todo_write` finish for an active task that has no execution report
 * yet. Such a finish is either a pure-output closing task (legitimate, no
 * actions to report) or a task whose premise was disproved and should be
 * reordered away. Only the model can tell, so the first attempt is refused for
 * confirmation instead of being either silently admitted or hard-rejected.
 * @param state - the current `todoLedger` projection.
 * @param execution - the `todo_write` execution whose parsed arguments are inspected.
 * @returns the finished task's current index and stable id, or undefined.
 */
export function unreportedFinish(state, execution) {
  const args = execution?.arguments;
  if (args === null || typeof args !== 'object' || !Number.isInteger(args.finish)) return undefined;
  const index = args.finish;
  if (!Array.isArray(state?.currentIds) || index < 1 || index > state.currentIds.length) return undefined;
  const task = state.nodes?.find((node) => node.id === state.currentIds[index - 1]);
  if (task?.status !== 'in_progress') return undefined;
  if ((task.reports?.length ?? 0) > 0) return undefined;
  return { index, taskId: task.id };
}

function reportRecorded(task, callId) {
  return task.reports?.at(-1)?.callId === callId;
}

function latestReport(state) {
  let latest;
  for (const node of state?.nodes ?? []) {
    // Reports are pruned at turn close, so the last entry of each node is also
    // that node's newest one.
    const report = node.reports?.at(-1);
    if (report === undefined) continue;
    if (latest === undefined || (report.seq ?? 0) > (latest.seq ?? 0)) latest = report;
  }
  return latest;
}

// Identity of the newest recorded report. Every counter that tracks whether a
// report landed compares this token, so a failed report leaves it unchanged.
function reportToken(state) {
  const latest = latestReport(state);
  return latest?.callId ?? latest?.seq;
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
function isPtcDispatch(execution) {
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
 * exemptible. A plan without an active task stays a hard violation, except when
 * a `todo_write` later in the same step may still create and start the first
 * task after this action runs, so the action is admitted as a bootstrap and the
 * following step re-checks the now-persisted plan.
 * @param state - the current `todoLedger` projection.
 * @param message - the assistant message that requested this step's tool calls.
 * @param execution - the execution being guarded; `rootCallId` identifies the
 *   model-requested call even for a nested PTC sub-dispatch.
 * @returns the coverage classification for the execution.
 */
export function stepCoverage(state, message, execution) {
  const calls = stepToolCalls(message);
  const rootIndex = callPosition(calls, execution.rootCallId);
  // Calls outside the tracked assistant step cannot be model actions; leave them unguarded.
  if (rootIndex < 0) return { outcome: 'exempt' };
  const root = calls[rootIndex];

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
    // The first plan may be written later in this same step. A write that
    // already ran earlier cannot help: it would have started the task or
    // finished the plan, so admitting the action then is unsafe. A later write
    // only bootstraps here when it actually adds tasks.
    const bootstrap = calls.some((call, index) => {
      if (index <= rootIndex || call.name !== 'todo_write') return false;
      const tasks = callArguments(call)?.todos;
      return Array.isArray(tasks) && tasks.length > 0;
    });
    if (bootstrap) return { outcome: 'bootstrap' };
    return { outcome: 'blocked', reason: GUARD_MESSAGES.noActiveTask };
  }

  const reports = calls.filter((call) => call.name === 'todo_report');
  if (reports.length === 0) return { outcome: 'uncovered', coverage: 'missing' };
  if (reports.some((report) => reportRecorded(task, String(report.id)))) {
    return { outcome: 'covered' };
  }

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
  // The guard's memory, grouped by the question each field answers. Keeping it
  // in one record makes the reset points explicit and stops another subtle
  // interaction from becoming another free-standing closure variable.
  // - step: the assistant message that already spent an admission, and whether
  //   that admission allowed its action;
  // - report: the newest recorded report already seen (budget reset), and the
  //   last provisional admission whose late report is not verified yet;
  // - finish: tasks whose first unreported finish was refused for confirmation;
  // - issue: the repeated-issue streak that was already steered;
  // - ptc: per-program dispatch records and the pending-report barrier;
  // - failure: whether an internal-error notice was already injected.
  const memory = {
    step: { message: undefined, admission: undefined },
    report: { recorded: undefined, pending: undefined },
    finish: new Set(),
    issue: { steered: undefined },
    ptc: { programs: new Map(), pending: false },
    failure: { reported: false },
  };

  function decide(message, state, coverage, guardedAgent) {
    const latestToken = reportToken(state);
    if (latestToken !== undefined && latestToken !== memory.report.recorded) {
      memory.report.recorded = latestToken;
      budget.reset();
    }
    // Hard blocks and recorded/pending reports never depend on the budget or
    // on an earlier admission cached for this message.
    if (coverage.outcome === 'blocked') return coverage.reason;
    if (
      coverage.outcome === 'covered'
      || coverage.outcome === 'provisional'
      || coverage.outcome === 'bootstrap'
    ) return undefined;
    // An assistant message may spend at most one admission. Later uncovered
    // actions reuse it, including a denial, without steering again.
    if (memory.step.message !== message) {
      memory.step.message = message;
      memory.step.admission = budget.admit();
      if (coverage.coverage === 'missing' && memory.step.admission.warning !== undefined) {
        steerAgent(guardedAgent, memory.step.admission.warning);
      }
    }
    if (!memory.step.admission.allowed) {
      // A report that exists but never records is a different failure than a
      // missing one: name the target the model should have reported instead of
      // repeating the "forgot to report" wording, which invites another retry.
      if (coverage.coverage === 'failed') {
        const active = activeTaskReference(state);
        if (active !== undefined) return fillPrompt(GUARD_MESSAGES.unrecordedReports, { active });
      }
      return GUARD_MESSAGES.budgetExhausted;
    }
    return undefined;
  }

  function steerRepeatedIssue(state, execution, guardedAgent) {
    const repeated = repeatedIssue(state, execution);
    if (repeated === undefined) {
      memory.issue.steered = undefined;
      return;
    }
    // One steer per issue streak is enough; a compliant report (one that omits
    // the name) clears the marker so a later relapse is corrected again.
    if (
      memory.issue.steered?.taskId === repeated.taskId
      && memory.issue.steered.issue === repeated.issue
    ) return;
    const text = fillPrompt(GUARD_MESSAGES.repeatedIssue, { issue: repeated.issue });
    // Record the correction only after the steer is delivered; a transient
    // failure must not suppress the reminder for the rest of the issue streak.
    if (steerAgent(execution.agent ?? guardedAgent, text)) memory.issue.steered = repeated;
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
        memory.ptc.programs.clear();
        return;
      }
      if (event.type === 'tool/call' && event.data?.name === RUN_CODE_NAME) {
        // A new program supersedes a record whose result never arrived.
        memory.ptc.programs.clear();
        return;
      }
      if (event.type === 'tool/ptc-dispatch') {
        const parentCallId = event.data?.parentCallId;
        if (typeof parentCallId !== 'string') return;
        const record = memory.ptc.programs.get(parentCallId) ?? { hadAction: false, reported: false };
        if (event.data?.name === 'todo_report') {
          if (event.data?.isError !== true) {
            record.reported = true;
            memory.ptc.pending = false;
            budget.reset();
          }
        } else if (!EXEMPT_TOOLS.has(event.data?.name)) {
          record.hadAction = true;
        }
        memory.ptc.programs.set(parentCallId, record);
        return;
      }
      if (event.type !== 'tool/result') return;
      const callId = event.data?.message?.callId;
      if (typeof callId !== 'string') return;
      const record = memory.ptc.programs.get(callId);
      if (!record) return;
      memory.ptc.programs.delete(callId);
      if (!record.hadAction || record.reported) return;
      const admission = budget.admit();
      if (!admission.allowed) {
        memory.ptc.pending = true;
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
      if (isPtcDispatch(execution) && !EXEMPT_TOOLS.has(execution.name) && memory.ptc.pending) {
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
      // A finish without any report is ambiguous. Refuse the first attempt so
      // the model can either reorder a disproved task or confirm a task that
      // only produces the final answer without tools.
      if (execution.name === 'todo_write') {
        // A reorder or a finished task can retire a confirmation the model will
        // never retry, so keep the set proportional to the current plan.
        for (const id of memory.finish) {
          const task = state?.nodes?.find((node) => node.id === id);
          if (task?.status !== 'in_progress') memory.finish.delete(id);
        }
        const unreported = unreportedFinish(state, execution);
        const finishBoundary = execution.rootCallId ?? execution.callId;
        // A report later in the same step counts: it will run after this finish,
        // and the ledger accepts it as the finished task's closing report.
        if (
          unreported
          && !memory.finish.delete(unreported.taskId)
          && !stepReportTargets(state, message, finishBoundary).has(unreported.taskId)
        ) {
          memory.finish.add(unreported.taskId);
          return fillPrompt(GUARD_MESSAGES.unreportedFinish, { index: unreported.index });
        }
      }
      // Every action re-reads the current state: an earlier todo_write in the
      // same message may finish the task or switch the active one.
      let coverage = stepCoverage(state, message, execution);
      if (coverage.outcome === 'exempt') {
        memory.failure.reported = false;
        return undefined;
      }
      // A late report is admitted before it runs, so the next step is the first
      // place that can verify it. When no report landed since that admission,
      // the promise was broken: this action is uncovered instead of receiving
      // another free pass. Without this check a step that pairs a failing late
      // report with an action would never spend the budget, so the guard could
      // not block the loop no matter how many times the report failed.
      if (coverage.outcome === 'provisional' && !isPtcDispatch(execution)) {
        const token = reportToken(state);
        const pending = memory.report.pending;
        if (pending !== undefined && pending.message !== message && pending.token === token) {
          coverage = { outcome: 'uncovered', coverage: 'failed' };
        }
        memory.report.pending = { message, token };
      }
      const decision = decide(message, state, coverage, execution.agent);
      memory.failure.reported = false;
      return decision;
    } catch (error) {
      if (!memory.failure.reported) {
        memory.failure.reported = true;
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

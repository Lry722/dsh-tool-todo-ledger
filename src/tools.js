import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { HISTORY_PROJECTION_KEY } from './history.js';
import {
  LEDGER_VERSION,
  currentView,
  legacyTodos,
  reportLedger,
  updateLedger,
} from './ledger.js';
import { TOOL_MESSAGES, TOOL_PROMPTS, fillPrompt } from './prompts.js';
import { callArguments, callPosition, stepToolCalls } from './step.js';

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true };
export const ACTIVE_TASK_REMINDER_MS = 60 * 1000;
// Exports are private temporary files; remove them even when the caller never
// deletes the returned path. The timer is unref'd so it cannot hold the host open.
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `todo_report` normally returns nothing. Once per real minute it also names the
 * active task, so a long stretch of work cannot keep reporting a target that was
 * already finished without the model being reminded to switch. The window starts
 * when the tool set is created and restarts whenever a reminder is emitted.
 * @param options - `now` overrides the clock for tests.
 * @returns a function that returns `{ content }` when a reminder is due.
 */
export function createActiveTaskReminder({ intervalMs = ACTIVE_TASK_REMINDER_MS, now = Date.now } = {}) {
  let remindedAt = now();
  return (state) => {
    const at = now();
    if (at - remindedAt < intervalMs) return undefined;
    for (const id of state.currentIds) {
      const task = state.nodes.find((node) => node.id === id);
      if (task?.status !== 'in_progress') continue;
      remindedAt = at;
      return { content: task.content };
    }
    return undefined;
  };
}

export function scheduleExportCleanup(directory, ttlMs = EXPORT_TTL_MS) {
  setTimeout(() => {
    void rm(directory, { recursive: true, force: true }).catch(() => {});
  }, ttlMs).unref?.();
}

function textOutput(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function presentation(title, kind = 'other') {
  return (args) => ({ card: 'generic', title, kind, rawInput: args });
}

function toolMessage(key, values) {
  return fillPrompt(TOOL_MESSAGES[key], values);
}

function owningState(ctx, exec, toolName) {
  if (!exec.agent) throw new Error(toolMessage('requiresAgent', { tool: toolName }));
  const state = ctx.sessionProjections.stateOf(exec.agent.session, 'todoLedger');
  if (!state) throw new Error(toolMessage('projectionUnavailable', { tool: toolName }));
  return state;
}

function owningHistory(ctx, session, toolName) {
  const events = ctx.sessionProjections.stateOf(session, HISTORY_PROJECTION_KEY);
  if (!events) throw new Error(toolMessage('projectionUnavailable', { tool: toolName }));
  return events;
}

function appendOperation(exec, todos, ledger) {
  exec.agent.session.append('todo/write', {
    todos,
    ledger: { version: LEDGER_VERSION, ...ledger },
  });
}

function recordReport(exec, state, index, inIssue, issue, callId) {
  const result = reportLedger(state, index, inIssue, issue);
  appendOperation(exec, legacyTodos(result.state), {
    operation: 'report',
    taskId: result.taskId,
    callId,
    report: result.report,
  });
  return result;
}

/**
 * The plan produced by every `todo_write` still listed after `callId` in this
 * assistant step. A report may name a task the later write has not created yet;
 * validating against this projection keeps the call order from mattering.
 * @param state - the current `todoLedger` projection.
 * @param message - the assistant message that requested this step's calls.
 * @param callId - the reporting call, which bounds the projection.
 * @returns the projected plan, or undefined when no later write applies.
 */
function projectedPlan(state, message, callId) {
  const calls = stepToolCalls(message);
  const position = callPosition(calls, callId);
  if (position < 0) return undefined;
  let projected = state;
  let writes = 0;
  for (const call of calls.slice(position + 1)) {
    if (call.name !== 'todo_write') continue;
    const args = callArguments(call);
    if (args === null || typeof args !== 'object') continue;
    try {
      projected = updateLedger(projected, args).state;
    } catch (_error) {
      return undefined;
    }
    writes += 1;
  }
  return writes === 0 ? undefined : projected;
}

async function exportHistory(ctx, agent) {
  const state = owningState(ctx, { agent }, 'todo_read');
  const session = agent.session;
  const events = owningHistory(ctx, session, 'todo_read');
  const document = {
    format: 'dsh-todo-ledger-history/v2',
    sessionId: String(session.id),
    exportedAt: new Date().toISOString(),
    state,
    events,
  };
  const safeId = String(session.id).replace(/[^A-Za-z0-9_-]/g, '_');
  const directory = await mkdtemp(join(tmpdir(), 'todo-ledger-'));
  const path = join(directory, `todo-ledger-${safeId}-${Date.now()}.json`);
  try {
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  scheduleExportCleanup(directory);
  return { path, eventCount: events.length };
}

export function createLedgerTools(ctx, stepOf, options) {
  const remindActiveTask = createActiveTaskReminder(options);
  // Reports that name a task a later write in the same step has not created yet.
  // Each intent is already validated against the projected plan; it is appended
  // only after that write lands. A tool set belongs to one agent and an agent
  // keeps one session, so the queue needs neither a session key nor a map.
  let deferred = { message: undefined, intents: [] };

  function queueDeferredReport(message, intent) {
    if (deferred.message !== message) deferred = { message, intents: [] };
    deferred.intents.push(intent);
  }

  function dropDeferred() {
    deferred = { message: undefined, intents: [] };
  }

  function flushDeferredReports(exec, message) {
    if (deferred.message !== message) {
      dropDeferred();
      return;
    }
    // A later write in the same step may still activate the target, so an
    // intent that cannot be recorded yet stays queued; the next step's first
    // write drops the whole queue, so nothing leaks past its step.
    const unresolved = [];
    for (const intent of deferred.intents) {
      const state = owningState(ctx, exec, 'todo_report');
      const index = state.currentIds.indexOf(intent.taskId) + 1;
      if (index < 1) {
        unresolved.push(intent);
        continue;
      }
      try {
        recordReport(exec, state, index, intent.inIssue, intent.issue, intent.callId);
      } catch (_error) {
        unresolved.push(intent);
      }
    }
    if (unresolved.length === 0) dropDeferred();
    else deferred.intents = unresolved;
  }

  return [
    defineTool({
      name: 'todo_write',
      description: TOOL_PROMPTS.todo_write.description,
      parameters: {
        todos: {
          type: 'array',
          description: TOOL_PROMPTS.todo_write.parameters.todos,
          items: { type: 'string' },
        },
        reorderFrom: {
          type: 'integer',
          description: TOOL_PROMPTS.todo_write.parameters.reorderFrom,
        },
        finish: {
          type: 'integer',
          description: TOOL_PROMPTS.todo_write.parameters.finish,
        },
      },
      output: { schema: OUTPUT_SCHEMA, render: textOutput },
      async execute(args, exec) {
        if (exec.signal?.aborted) return {};
        const result = updateLedger(owningState(ctx, exec, 'todo_write'), args);
        for (const operation of result.operations) {
          appendOperation(exec, operation.todos, {
            ...operation.ledger,
            ...(operation.ledger.operation === 'start' ? { callId: String(exec.callId) } : {}),
          });
        }
        flushDeferredReports(exec, stepOf?.(exec.agent.session));
        const withoutInternalId = ({ id, ...task }) => task;
        const transitionResult = ({ taskId }) => ({
          content: result.state.nodes.find((node) => node.id === taskId).content,
        });
        return {
          ...(result.finished ? { finished: transitionResult(result.finished) } : {}),
          ...(result.write ? {
            mode: result.write.mode,
            added: result.write.added.map(withoutInternalId),
            ...(result.write.mode === 'reorder' ? {
              invalidated: result.write.invalidated.map(withoutInternalId),
              tasks: currentView(result.state).tasks,
            } : {}),
          } : {}),
          ...(result.started ? { started: transitionResult(result.started) } : {}),
        };
      },
      presentCall: presentation(TOOL_MESSAGES.presentation.todo_write, 'edit'),
    }),
    defineTool({
      name: 'todo_read',
      description: TOOL_PROMPTS.todo_read.description,
      parameters: {
        full: {
          type: 'boolean',
          description: TOOL_PROMPTS.todo_read.parameters.full,
        },
      },
      output: { schema: OUTPUT_SCHEMA, render: textOutput },
      async execute(args, exec) {
        if (!exec.agent) throw new Error(toolMessage('requiresAgent', { tool: 'todo_read' }));
        if (args.full === true) return exportHistory(ctx, exec.agent);
        return currentView(owningState(ctx, exec, 'todo_read'));
      },
      presentCall: presentation(TOOL_MESSAGES.presentation.todo_read, 'read'),
    }),
    defineTool({
      name: 'todo_report',
      description: TOOL_PROMPTS.todo_report.description,
      parameters: {
        index: {
          type: 'integer',
          required: true,
          description: TOOL_PROMPTS.todo_report.parameters.index,
        },
        inIssue: {
          type: 'boolean',
          required: true,
          description: TOOL_PROMPTS.todo_report.parameters.inIssue,
        },
        issue: {
          type: 'string',
          description: TOOL_PROMPTS.todo_report.parameters.issue,
        },
      },
      output: { schema: OUTPUT_SCHEMA, render: textOutput },
      async execute(args, exec) {
        if (exec.signal?.aborted) return {};
        const state = owningState(ctx, exec, 'todo_report');
        if (args.index > state.currentIds.length) {
          const message = stepOf?.(exec.agent.session);
          const projected = projectedPlan(state, message, exec.callId);
          if (projected !== undefined) {
            // Validate against the plan the later write will produce, so a
            // task that stays pending or an unnamed issue still fails now.
            const future = reportLedger(projected, args.index, args.inIssue, args.issue);
            queueDeferredReport(message, {
              taskId: future.taskId,
              // Keep the issue resolved against the projected plan: another
              // report later in the step must not change what this one continues.
              inIssue: future.report.inIssue,
              issue: future.report.issue,
              callId: String(exec.callId),
            });
            return { deferred: true };
          }
        }
        const result = recordReport(exec, state, args.index, args.inIssue, args.issue, String(exec.callId));
        return remindActiveTask(result.state) ?? {};
      },
      presentCall: presentation(TOOL_MESSAGES.presentation.todo_report),
    }),
  ];
}

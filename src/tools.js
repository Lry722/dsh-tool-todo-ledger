import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  LEDGER_VERSION,
  currentView,
  legacyTodos,
  numberedPlan,
  reportLedger,
  updateLedger,
} from './ledger.js';
import { reviewTodoWrite } from './review.js';
import { TOOL_MESSAGES, TOOL_PROMPTS, fillPrompt, reviewResult } from './prompts.js';

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true };

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

function appendOperation(exec, todos, ledger) {
  exec.agent.session.append('todo/write', {
    todos,
    ledger: { version: LEDGER_VERSION, ...ledger },
  });
}

async function exportHistory(ctx, agent) {
  const session = agent.session;
  const state = ctx.sessionProjections.stateOf(session, 'todoLedger');
  const events = session.snapshotEvents()
    .filter((event) => event.type === 'todo/write')
    .map((event) => ({ seq: event.seq, time: event.time, data: event.data }));
  const document = {
    format: 'dsh-todo-ledger-history/v1',
    sessionId: String(session.id),
    exportedAt: new Date().toISOString(),
    state,
    events,
  };
  const safeId = String(session.id).replace(/[^A-Za-z0-9_-]/g, '_');
  const path = join(tmpdir(), `todo-ledger-${safeId}-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { path, eventCount: events.length };
}

export function createLedgerTools(ctx, config) {
  const reviewEnabled = () => typeof config.reviewEnabled === 'object' && config.reviewEnabled !== null
    ? config.reviewEnabled.get()
    : config.reviewEnabled === true;
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
        let review;
        if (result.write && reviewEnabled()) {
          const pending = {
            mode: result.write.mode,
            ...(result.write.reorderFrom === undefined ? {} : { reorderFrom: result.write.reorderFrom }),
            todos: result.write.added.map((task) => task.content),
            invalidated: result.write.invalidated,
          };
          try {
            review = await reviewTodoWrite(ctx, exec.agent, pending, exec.signal);
            if (review.status === 'warning') review.message = reviewResult('warning', review.message);
          } catch (error) {
            review = undefined;
            if (!exec.signal?.aborted) {
              const reason = error instanceof Error ? error.message : String(error);
              ctx.logger?.warn(`todo-ledger: plan review skipped: ${reason}`);
            }
          }
        }
        if (exec.signal?.aborted) return {};
        for (const operation of result.operations) {
          appendOperation(exec, operation.todos, {
            ...operation.ledger,
            ...(operation.ledger.operation === 'start' ? { callId: String(exec.callId) } : {}),
          });
        }
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
              plan: numberedPlan(result.state),
            } : {}),
          } : {}),
          ...(result.started ? { started: transitionResult(result.started) } : {}),
          ...(review ? { review } : {}),
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
        const result = reportLedger(
          owningState(ctx, exec, 'todo_report'),
          args.index,
          args.inIssue,
          args.issue,
        );
        appendOperation(exec, legacyTodos(result.state), {
          operation: 'report',
          taskId: result.taskId,
          callId: String(exec.callId),
          report: result.report,
        });
        return {};
      },
      presentCall: presentation(TOOL_MESSAGES.presentation.todo_report),
    }),
  ];
}

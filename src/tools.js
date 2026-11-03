import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  LEDGER_VERSION,
  currentView,
  finishLedger,
  legacyTodos,
  numberedPlan,
  reportLedger,
  startLedger,
  writeLedger,
} from './ledger.js';
import { reviewTodoWrite } from './review.js';
import { TOOL_PROMPTS, reviewResult } from './prompts.js';

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true };

function textOutput(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function presentation(title, kind = 'other') {
  return (args) => ({ card: 'generic', title, kind, rawInput: args });
}

function owningState(ctx, exec, toolName) {
  if (!exec.agent) throw new Error(`${toolName} requires an owning agent session`);
  const state = ctx.sessionProjections.stateOf(exec.agent.session, 'todoLedger');
  if (!state) throw new Error(`${toolName}: todoLedger projection is unavailable`);
  return state;
}

function appendOperation(exec, state, ledger) {
  exec.agent.session.append('todo/write', {
    todos: legacyTodos(state),
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
          required: true,
          description: TOOL_PROMPTS.todo_write.parameters.todos,
          items: { type: 'string' },
        },
        start: {
          type: 'integer',
          description: TOOL_PROMPTS.todo_write.parameters.start,
        },
      },
      output: { schema: OUTPUT_SCHEMA, render: textOutput },
      async execute(args, exec) {
        const state = owningState(ctx, exec, 'todo_write');
        const result = writeLedger(state, args.todos, args.start);
        let review;
        if (reviewEnabled()) {
          const pending = {
            mode: result.mode,
            ...(result.start === undefined ? {} : { start: result.start }),
            todos: result.added.map((task) => task.content),
            invalidated: result.invalidated,
          };
          try {
            review = await reviewTodoWrite(ctx, exec.agent, pending, exec.signal);
            if (review.status === 'warning') review.message = reviewResult('warning', review.message);
          } catch {
            review = undefined;
          }
        }
        appendOperation(exec, result.state, {
          operation: 'write',
          mode: result.mode,
          ...(result.start === undefined ? {} : { start: result.start }),
          added: result.added.map(({ id, content }) => ({ id, content })),
          invalidatedIds: result.invalidated.map((task) => task.id),
        });
        return {
          mode: result.mode,
          added: result.added,
          ...(result.mode === 'reorder' ? {
            invalidated: result.invalidated,
            plan: numberedPlan(result.state),
          } : {}),
          ...(review ? { review } : {}),
        };
      },
      presentCall: presentation('Update todo tasks', 'edit'),
    }),
    defineTool({
      name: 'todo_start',
      description: TOOL_PROMPTS.todo_start.description,
      parameters: {
        index: { type: 'integer', required: true, description: TOOL_PROMPTS.todo_start.parameters.index },
      },
      output: { schema: OUTPUT_SCHEMA, render: textOutput },
      async execute(args, exec) {
        const result = startLedger(owningState(ctx, exec, 'todo_start'), args.index);
        appendOperation(exec, result.state, { operation: 'start', taskId: result.taskId, callId: String(exec.callId) });
        return { index: args.index, taskId: result.taskId, status: 'in_progress' };
      },
      presentCall: presentation('Start todo task'),
    }),
    defineTool({
      name: 'todo_finish',
      description: TOOL_PROMPTS.todo_finish.description,
      parameters: {
        index: { type: 'integer', required: true, description: TOOL_PROMPTS.todo_finish.parameters.index },
      },
      output: { schema: OUTPUT_SCHEMA, render: textOutput },
      async execute(args, exec) {
        const result = finishLedger(owningState(ctx, exec, 'todo_finish'), args.index);
        appendOperation(exec, result.state, { operation: 'finish', taskId: result.taskId });
        return { index: args.index, taskId: result.taskId, status: 'completed' };
      },
      presentCall: presentation('Finish todo task'),
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
        if (!exec.agent) throw new Error('todo_read requires an owning agent session');
        if (args.full === true) return exportHistory(ctx, exec.agent);
        return currentView(owningState(ctx, exec, 'todo_read'));
      },
      presentCall: presentation('Read todo tasks', 'read'),
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
        inLocalTask: {
          type: 'boolean',
          required: true,
          description: TOOL_PROMPTS.todo_report.parameters.inLocalTask,
        },
        localTask: {
          type: 'string',
          description: TOOL_PROMPTS.todo_report.parameters.localTask,
        },
      },
      output: { schema: OUTPUT_SCHEMA, render: textOutput },
      async execute(args, exec) {
        const result = reportLedger(
          owningState(ctx, exec, 'todo_report'),
          args.index,
          args.inLocalTask,
          args.localTask,
        );
        appendOperation(exec, result.state, {
          operation: 'report',
          taskId: result.taskId,
          report: result.report,
        });
        return {};
      },
      presentCall: presentation('Report todo progress'),
    }),
  ];
}

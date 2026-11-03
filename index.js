import z from '@deepseek-ai/schemastery';
import { z as zod } from 'zod';
import { LEDGER_VERSION, dockTodos, emptyLedger, foldLedgerEvent } from './src/ledger.js';
import { createLedgerTools } from './src/tools.js';
import { REPORTING_SECTION } from './src/prompts.js';
import { installReportReminder } from './src/reminder.js';

export const name = 'tool-todo-ledger';
export const inject = ['agents', 'llm', 'sessionProjections', 'systemPrompt', 'tools'];
export const Config = z.object({ reviewEnabled: z.boolean().default(false).volatile() });

const reportSchema = zod.object({
  index: zod.number().int(),
  inLocalTask: zod.boolean(),
  localTask: zod.string().optional(),
  seq: zod.number().optional(),
  time: zod.number().optional(),
});

const todoViewSchema = zod.array(zod.object({
  content: zod.string(),
  status: zod.enum(['pending', 'in_progress', 'completed']),
  localTask: zod.string().optional(),
  startCallId: zod.string().optional(),
  startSeq: zod.number().optional(),
}));

const ledgerStateSchema = zod.object({
  version: zod.literal(LEDGER_VERSION),
  nodes: zod.array(zod.object({
    id: zod.string(),
    content: zod.string(),
    status: zod.enum(['pending', 'in_progress', 'completed', 'void']),
    reports: zod.array(reportSchema),
    createdSeq: zod.number(),
    createdTime: zod.number(),
    startCallId: zod.string().optional(),
    startSeq: zod.number().optional(),
    voidedSeq: zod.number().optional(),
    voidedTime: zod.number().optional(),
  })),
  currentIds: zod.array(zod.string()),
  lastReportTaskId: zod.string().nullable(),
  lastToolCallId: zod.string().nullable(),
  nextTaskNumber: zod.number().int().positive(),
});

export function apply(ctx, config) {
  ctx.sessionProjections.register({
    key: 'todoLedger',
    stateSchema: ledgerStateSchema,
    init: emptyLedger,
    apply: foldLedgerEvent,
    wire: { viewSchema: todoViewSchema, view: dockTodos },
    stateVersion: 3,
  });
  installReportReminder(ctx);

  const attached = new Map();
  const attach = (agent) => {
    if (attached.has(agent)) return;
    const dispose = ctx.effect(() => agent.ctx.effect(() => {
      const registrations = createLedgerTools(ctx, config).map((tool) => agent.ctx.tools.register(tool));
      registrations.push(agent.ctx.systemPrompt.section({
        name: 'tool:todo-ledger-reporting',
        order: 620,
        interpolate: false,
        text: REPORTING_SECTION,
      }));
      return () => {
        for (const unregister of registrations.reverse()) unregister();
      };
    }, 'todo-ledger agent tools'));
    attached.set(agent, dispose);
  };

  ctx.on('agent/created', ({ agent }) => attach(agent));
  ctx.on('agent/disposed', ({ agent }) => {
    attached.get(agent)?.();
    attached.delete(agent);
  });
  for (const agent of ctx.agents.list()) attach(agent);
}

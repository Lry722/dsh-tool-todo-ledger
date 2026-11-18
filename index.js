import z from '@deepseek-ai/schemastery';
import { z as zod } from 'zod';
import { LEDGER_VERSION, emptyLedger, foldLedgerEvent, ledgerView } from './src/ledger.js';
import { historyProjection } from './src/history.js';
import { ACTIVE_TASK_REMINDER_MS, createLedgerTools } from './src/tools.js';
import { installReportGuard, installStepTracker } from './src/guard.js';

export const name = 'tool-todo-ledger';
export const inject = ['agents', 'sessionProjections', 'tools'];
export const Config = z.object({
  reminderIntervalMs: z.natural()
    .max(Number.MAX_SAFE_INTEGER)
    .default(ACTIVE_TASK_REMINDER_MS)
    .description('周期性提醒当前任务与 issue 的间隔（毫秒）。0 表示关闭提醒。')
    .volatile(),
});

const reportSchema = zod.object({
  // A report may lack an index. Accepting the absent field keeps the schema
  // aligned with the states the fold can produce.
  index: zod.number().int().optional(),
  inIssue: zod.boolean(),
  issue: zod.string().optional(),
  callId: zod.string().optional(),
  // The fold stamps the event seq on every report, so summaries never need to
  // fall back to wall-clock time for ordering.
  seq: zod.number(),
});

const navigationSchema = {
  startCallId: zod.string().optional(),
  startSeq: zod.number().optional(),
};

const issueSummarySchema = zod.object({
  name: zod.string(),
  firstSeq: zod.number(),
  lastSeq: zod.number(),
  ...navigationSchema,
});

const issueViewSchema = issueSummarySchema.extend({
  active: zod.boolean(),
});

const dockViewSchema = zod.array(zod.object({
  content: zod.string(),
  status: zod.enum(['pending', 'in_progress', 'completed']),
  issue: zod.string().optional(),
  issueCallId: zod.string().optional(),
  issueSeq: zod.number().optional(),
  ...navigationSchema,
}));

const historyTaskSchema = zod.object({
  id: zod.string(),
  content: zod.string(),
  status: zod.enum(['pending', 'in_progress', 'completed', 'void']),
  ...navigationSchema,
  issues: zod.array(issueViewSchema),
});

const todoViewSchema = zod.object({
  currentTurn: zod.number().int().nonnegative(),
  dock: dockViewSchema,
  current: zod.array(historyTaskSchema.extend({
    index: zod.number().int().positive(),
    status: zod.enum(['pending', 'in_progress', 'completed']),
  })),
  turns: zod.array(zod.object({
    turn: zod.number().int().nonnegative(),
    startSeq: zod.number(),
    endSeq: zod.number().optional(),
    open: zod.boolean(),
    total: zod.number().int().nonnegative(),
    completed: zod.number().int().nonnegative(),
    voided: zod.number().int().nonnegative(),
    preview: zod.string(),
    tasks: zod.array(historyTaskSchema),
  })),
});

const ledgerStateSchema = zod.object({
  version: zod.literal(LEDGER_VERSION),
  nodes: zod.array(zod.object({
    id: zod.string(),
    content: zod.string(),
    status: zod.enum(['pending', 'in_progress', 'completed', 'void']),
    // Only the open turn keeps more than its last report. Closed turns fold the
    // rest into `turns[].issues`.
    reports: zod.array(reportSchema),
    startCallId: zod.string().optional(),
    startSeq: zod.number().optional(),
    // Completion metadata scopes a late report to the step that finished the
    // task. Without these fields, late reports are rejected.
    finishTurn: zod.number().int().nonnegative().optional(),
    finishStep: zod.number().int().nonnegative().optional(),
  })),
  currentIds: zod.array(zod.string()),
  lastReportTaskId: zod.string().nullable(),
  lastToolCallId: zod.string().nullable(),
  lastToolCallTurn: zod.number().int().nonnegative().optional(),
  lastToolCallStep: zod.number().int().nonnegative().optional(),
  currentTurn: zod.number().int().nonnegative(),
  turns: zod.array(zod.object({
    turn: zod.number().int().nonnegative(),
    startSeq: zod.number(),
    taskIds: zod.array(zod.string()),
    endSeq: zod.number().optional(),
    endStatuses: zod.record(zod.string(), zod.enum(['pending', 'in_progress', 'completed', 'void'])).optional(),
    // Issue summaries for the reports this turn contained, kept so archived
    // turns never need the raw reports again.
    issues: zod.record(zod.string(), zod.array(issueSummarySchema)).optional(),
  })),
});

export function apply(ctx, config = {}) {
  // The interval is a volatile setting: reading it lazily keeps a settings edit
  // effective without recreating the tools that already belong to an agent.
  const reminderIntervalMs = () => {
    const value = typeof config.reminderIntervalMs?.get === 'function'
      ? config.reminderIntervalMs.get()
      : config.reminderIntervalMs;
    return value ?? ACTIVE_TASK_REMINDER_MS;
  };
  ctx.sessionProjections.register({
    key: 'todoLedger',
    stateSchema: ledgerStateSchema,
    init: emptyLedger,
    apply: foldLedgerEvent,
    wire: { viewSchema: todoViewSchema, view: ledgerView },
    stateVersion: 10,
  });
  ctx.sessionProjections.register(historyProjection());
  const stepOf = installStepTracker(ctx);

  const attached = new Map();
  const attach = (agent) => {
    if (attached.has(agent)) return;
    const dispose = ctx.effect(() => agent.ctx.effect(() => {
      const registrations = createLedgerTools(ctx, stepOf, { intervalMs: reminderIntervalMs })
        .map((tool) => agent.ctx.tools.register(tool));
      registrations.push(installReportGuard(ctx, agent, stepOf));
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

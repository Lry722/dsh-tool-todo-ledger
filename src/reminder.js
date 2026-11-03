import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';

const EXEMPT_TOOLS = new Set(['todo_write', 'todo_read', 'todo_report']);
const REMINDER_SOURCE = 'todo-ledger-reminder';

export function missingReport(message) {
  const calls = message.content.filter((block) => block.type === 'tool-call');
  if (calls.every((block) => EXEMPT_TOOLS.has(block.name))) return false;
  return !calls.some((block) => block.name === 'todo_report');
}

export function inProgressTask(state) {
  if (!state || !Array.isArray(state.currentIds)) return undefined;
  for (const id of state.currentIds) {
    const task = state.nodes?.find((node) => node.id === id);
    if (task?.status === 'in_progress') return task;
  }
  return undefined;
}

export function reportReminder(content) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: `The previous step used tools without todo_report. Main task ${JSON.stringify(content)} is in progress, so this step must include exactly one todo_report call alongside its other tool calls. State inLocalTask explicitly and provide localTask when entering a local task.`,
    }],
    source: {
      kind: REMINDER_SOURCE,
      form: 'notice',
      summary: boundContextSummary('Missing todo_report in the previous step'),
    },
  });
}

export function installReportReminder(ctx) {
  return ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message' || event.data?.interrupted) return;
    const message = event.data?.message;
    if (!message?.content) return;
    const missing = missingReport(message);
    if (!missing) return;
    const task = inProgressTask(ctx.sessionProjections.stateOf(session, 'todoLedger'));
    if (!task) return;
    const agent = ctx.agents.get(session.id);
    if (!agent) return;
    const notice = reportReminder(task.content);
    // Session observers run inside the append transaction, so queue the notice
    // for the next admitted step instead of appending from this stack.
    queueMicrotask(() => {
      try {
        agent.inject(notice);
      } catch {
        // The agent may have been disposed before the notice was queued.
      }
    });
  });
}

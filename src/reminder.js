import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm';

const EXEMPT_TOOLS = new Set(['todo_write', 'todo_read', 'todo_report']);
const REMINDER_SOURCE = 'todo-ledger-reminder';

export function missingReportTools(message) {
  const calls = message.content.filter((block) => block.type === 'tool-call');
  const work = calls.filter((block) => !EXEMPT_TOOLS.has(block.name));
  if (work.length === 0) return null;
  if (calls.some((block) => block.name === 'todo_report')) return null;
  return [...new Set(work.map((block) => block.name))];
}

export function inProgressTaskIndex(state) {
  if (!state || !Array.isArray(state.currentIds)) return 0;
  const index = state.currentIds.findIndex((id) => {
    const task = state.nodes?.find((node) => node.id === id);
    return task?.status === 'in_progress';
  });
  return index < 0 ? 0 : index + 1;
}

export function reportReminder(names, index) {
  const tools = names.map((name) => `\`${name}\``).join(', ');
  return createUserMessage({
    content: [{
      type: 'text',
      text: `The previous step called ${tools} without todo_report. Main task ${index} is in progress, so this step must include exactly one todo_report call alongside its other tool calls. State inLocalTask explicitly and provide localTask when entering a local task.`,
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
    const names = missingReportTools(message);
    if (!names) return;
    const index = inProgressTaskIndex(ctx.sessionProjections.stateOf(session, 'todoLedger'));
    if (index === 0) return;
    const agent = ctx.agents.get(session.id);
    if (!agent) return;
    const notice = reportReminder(names, index);
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

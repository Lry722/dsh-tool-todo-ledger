import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerTools } from '../src/tools.js';
import { emptyLedger, foldLedgerEvent } from '../src/ledger.js';
import { TOOL_PROMPTS } from '../src/prompts.js';

function harness({ enabled = false, reviewText = '{"compliant":true}', instructions = [] } = {}) {
  let state = emptyLedger();
  let seq = 0;
  const appended = [];
  const events = new Map(instructions.map((text, index) => [index + 1, {
    type: 'user/message',
    data: { source: { kind: 'agent-instructions' }, content: [{ type: 'text', text }] },
  }]));
  const ctx = {
    sessionProjections: { stateOf: () => state },
    llm: {
      stream() {
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: reviewText };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    },
  };
  const agent = {
    session: {
      surface: { nodes: [...events.keys()] },
      eventAt: (sequence) => events.get(sequence),
      requestHeader: () => ({ config: { provider: 'test', model: 'test' } }),
      append(type, data) {
        const event = { type, data, seq: ++seq, time: seq * 100 };
        appended.push(event);
        state = foldLedgerEvent(state, event);
      },
    },
  };
  let current = enabled;
  const config = { reviewEnabled: { get: () => current } };
  const tools = Object.fromEntries(createLedgerTools(ctx, config).map((tool) => [tool.name, tool]));
  return {
    tools,
    agent,
    appended,
    setEnabled(value) { current = value; },
    exec: { agent, callId: 'call-1', signal: new AbortController().signal },
  };
}

test('todo_write appends a replayable delta and volatile review config is read per call', async () => {
  const env = harness();
  const first = await env.tools.todo_write.execute({ todos: ['First'] }, env.exec);
  assert.equal(first.review, undefined);
  assert.equal(first.added[0].index, 1);
  assert.equal(env.appended[0].data.ledger.operation, 'write');
  assert.deepEqual(env.appended[0].data.todos, [{ content: 'First', status: 'pending' }]);

  env.setEnabled(true);
  const second = await env.tools.todo_write.execute({ todos: ['Second'] }, env.exec);
  assert.equal(second.review.status, 'passed');
  assert.equal(env.appended.length, 2);
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks.map((task) => task.content), ['First', 'Second']);
});

test('review warnings are returned while technical failures stay invisible', async () => {
  const warning = harness({
    enabled: true,
    instructions: ['Write tests before implementation.'],
    reviewText: '{"compliant":false,"message":"Add the required test task."}',
  });
  const warned = await warning.tools.todo_write.execute({ todos: ['Implement'] }, warning.exec);
  assert.equal(warned.review.status, 'warning');
  assert.equal(warned.review.message, 'AGENTS.md review warning: Add the required test task.');
  assert.equal(warning.appended.length, 1);

  const malformed = harness({ enabled: true, instructions: ['Plan.'], reviewText: 'bad json' });
  const continued = await malformed.tools.todo_write.execute({ todos: ['Implement'] }, malformed.exec);
  assert.equal(Object.hasOwn(continued, 'review'), false);
  assert.equal(malformed.appended.length, 1);
});

test('start, report and finish tools append their respective operations', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['Task'] }, env.exec);
  await env.tools.todo_start.execute({ index: 1 }, env.exec);
  const reported = await env.tools.todo_report.execute({ index: 1, inLocalTask: true, localTask: 'Local' }, env.exec);
  const maintained = await env.tools.todo_report.execute({ index: 1, inLocalTask: true }, env.exec);
  await env.tools.todo_finish.execute({ index: 1 }, env.exec);
  assert.deepEqual(reported, {});
  assert.deepEqual(maintained, {});
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start', 'report', 'report', 'finish']);
  assert.equal(env.appended[2].data.ledger.report.localTask, 'Local');
  assert.equal(env.appended[3].data.ledger.report.localTask, 'Local');
  assert.equal(env.appended[1].data.ledger.callId, 'call-1');
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks, [{ index: 1, content: 'Task', status: 'completed' }]);
});

test('tool descriptions use defined task terminology instead of runtime jargon', () => {
  const { tools } = harness();
  for (const tool of Object.values(tools)) {
    const prompt = TOOL_PROMPTS[tool.name];
    assert.equal(tool.description, prompt.description, `${tool.name} description`);
    for (const [name, parameter] of Object.entries(tool.parameters)) {
      assert.equal(parameter.description, prompt.parameters[name], `${tool.name}.${name} description`);
    }
    const parameters = Object.values(tool.parameters).map((parameter) => parameter.description ?? '');
    const text = [tool.description, ...parameters].join('\n');
    assert.doesNotMatch(text, /\b(?:ledger|step|stateless|voids|voided|bounded|top-level|1-based)\b/i, tool.name);
  }
});

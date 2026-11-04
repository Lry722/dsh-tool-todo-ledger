import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerTools } from '../src/tools.js';
import { emptyLedger, foldLedgerEvent } from '../src/ledger.js';
import { TOOL_PROMPTS } from '../src/prompts.js';

function harness({ enabled = false, reviewText = '{"compliant":true}', instructions = [] } = {}) {
  let state = emptyLedger();
  let seq = 0;
  let reviewCalls = 0;
  const appended = [];
  const events = new Map(instructions.map((text, index) => [index + 1, {
    type: 'user/message',
    data: { source: { kind: 'agent-instructions' }, content: [{ type: 'text', text }] },
  }]));
  const ctx = {
    sessionProjections: { stateOf: () => state },
    llm: {
      stream() {
        reviewCalls += 1;
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
    reviewCalls() { return reviewCalls; },
    exec: { agent, callId: 'call-1', signal: new AbortController().signal },
  };
}

test('todo_write appends a replayable delta and volatile review config is read per call', async () => {
  const env = harness();
  assert.deepEqual(Object.keys(env.tools), ['todo_write', 'todo_read', 'todo_report']);
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

test('composite writes preserve separate start, report and finish operations', async () => {
  const env = harness();
  const created = await env.tools.todo_write.execute({ todos: ['Task'], start: 1 }, env.exec);
  assert.deepEqual(created.started, { index: 1, taskId: 't1', status: 'in_progress' });
  const reported = await env.tools.todo_report.execute({ index: 1, inIssue: true, issue: 'Local' }, env.exec);
  const maintained = await env.tools.todo_report.execute({ index: 1, inIssue: true }, env.exec);
  const finished = await env.tools.todo_write.execute({ finish: 1 }, env.exec);
  assert.deepEqual(finished.finished, { index: 1, taskId: 't1', status: 'completed' });
  assert.deepEqual(reported, {});
  assert.deepEqual(maintained, {});
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start', 'report', 'report', 'finish']);
  assert.equal(env.appended[2].data.ledger.report.inIssue, true);
  assert.equal(env.appended[2].data.ledger.report.issue, 'Local');
  assert.equal(env.appended[3].data.ledger.report.inIssue, true);
  assert.equal(env.appended[3].data.ledger.report.issue, 'Local');
  assert.equal(env.appended[1].data.ledger.callId, 'call-1');
  assert.equal(env.appended[2].data.ledger.callId, 'call-1');
  assert.equal(env.appended[3].data.ledger.callId, 'call-1');
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks, [{ index: 1, content: 'Task', status: 'completed' }]);
});

test('finish and start share one call without triggering plan review', async () => {
  const env = harness({ enabled: true, instructions: ['Plan carefully.'] });
  await env.tools.todo_write.execute({ todos: ['One', 'Two'], start: 1 }, env.exec);
  assert.equal(env.reviewCalls(), 1);
  const result = await env.tools.todo_write.execute({ finish: 1, start: 2 }, env.exec);
  assert.equal(env.reviewCalls(), 1);
  assert.deepEqual(result, {
    finished: { index: 1, taskId: 't1', status: 'completed' },
    started: { index: 2, taskId: 't2', status: 'in_progress' },
  });
  assert.deepEqual(env.appended.map((event) => event.data.ledger.operation), ['write', 'start', 'finish', 'start']);
  assert.deepEqual(env.appended[2].data.todos, [
    { content: 'One', status: 'completed' },
    { content: 'Two', status: 'pending' },
  ]);
  assert.deepEqual(env.appended[3].data.todos, [
    { content: 'One', status: 'completed' },
    { content: 'Two', status: 'in_progress' },
  ]);
});

test('reorder and start returns the final active plan', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['One', 'Two', 'Three'], start: 1 }, env.exec);
  await env.tools.todo_write.execute({ finish: 1, start: 2 }, env.exec);
  const result = await env.tools.todo_write.execute({
    reorderFrom: 2,
    todos: ['Replacement', 'Later'],
    start: 2,
  }, env.exec);
  assert.equal(result.mode, 'reorder');
  assert.deepEqual(result.invalidated.map((task) => task.content), ['Two', 'Three']);
  assert.deepEqual(result.plan, [
    { index: 1, content: 'One', status: 'completed' },
    { index: 2, content: 'Replacement', status: 'in_progress' },
    { index: 3, content: 'Later', status: 'pending' },
  ]);
  assert.deepEqual(env.appended.at(-2).data.ledger.reorderFrom, 2);
  assert.equal(env.appended.at(-1).data.ledger.operation, 'start');
});

test('a failed composite call appends no partial operations', async () => {
  const env = harness();
  await env.tools.todo_write.execute({ todos: ['One', 'Two'], start: 1 }, env.exec);
  const eventCount = env.appended.length;
  await assert.rejects(
    env.tools.todo_write.execute({ finish: 1, start: 3 }, env.exec),
    /task index must be between/,
  );
  assert.equal(env.appended.length, eventCount);
  const read = await env.tools.todo_read.execute({}, env.exec);
  assert.deepEqual(read.tasks, [
    { index: 1, content: 'One', status: 'in_progress' },
    { index: 2, content: 'Two', status: 'pending' },
  ]);
});

test('tool descriptions use defined task terminology instead of runtime jargon', () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(TOOL_PROMPTS), Object.keys(tools));
  for (const tool of Object.values(tools)) {
    const prompt = TOOL_PROMPTS[tool.name];
    assert.equal(tool.description, prompt.description, `${tool.name} description`);
    for (const [name, parameter] of Object.entries(tool.parameters)) {
      assert.equal(parameter.description, prompt.parameters[name], `${tool.name}.${name} description`);
    }
    const parameters = Object.values(tool.parameters).map((parameter) => parameter.description ?? '');
    const text = [tool.description, ...parameters].join('\n');
    assert.doesNotMatch(text, /\b(?:ledger|step|stateless|voids|voided|bounded|top-level|1-based|localTask|local task)\b/i, tool.name);
  }
  assert.match(TOOL_PROMPTS.todo_write.description, /Issue reports never complete or advance main tasks/);
  assert.match(TOOL_PROMPTS.todo_write.description, /finish for the current task and start for the next task in the same call/);
  assert.match(TOOL_PROMPTS.todo_write.description, /rejected until one is in progress/);
  assert.match(TOOL_PROMPTS.todo_write.parameters.start, /instead of using start alone/);
  assert.match(TOOL_PROMPTS.todo_report.description, /in that same assistant message/);
  assert.match(TOOL_PROMPTS.todo_report.description, /Do not send todo_report alone in an earlier message/);
  assert.match(TOOL_PROMPTS.todo_report.parameters.inIssue, /distinct, narrower subtask/);
  assert.match(TOOL_PROMPTS.todo_report.parameters.inIssue, /Never use an issue to restate the main task/);
  assert.match(TOOL_PROMPTS.todo_report.parameters.issue, /provide issue when entering or changing an issue/);
  assert.match(TOOL_PROMPTS.todo_report.parameters.issue, /re-entering after inIssue:false/);
  assert.match(TOOL_PROMPTS.todo_report.parameters.issue, /Omit it only while continuing the same active issue in the same main task/);
  assert.match(TOOL_PROMPTS.todo_report.parameters.issue, /do not repeat it on every report/);
  assert.match(TOOL_PROMPTS.todo_report.parameters.issue, /never copy or paraphrase the main task/);
});

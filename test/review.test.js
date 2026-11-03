import test from 'node:test';
import assert from 'node:assert/strict';
import { activeProjectInstructions, reviewTodoWrite } from '../src/review.js';

function agentWithInstructions(instructions, stream) {
  const events = new Map();
  instructions.forEach((instruction, index) => events.set(index + 1, {
    type: 'user/message',
    data: {
      source: { kind: 'agent-instructions', path: instruction.path },
      content: [{ type: 'text', text: instruction.text }],
    },
  }));
  events.set(99, {
    type: 'user/message',
    data: { source: { kind: 'human' }, content: [{ type: 'text', text: 'Not an AGENTS instruction' }] },
  });
  return {
    session: {
      surface: { nodes: [...events.keys()] },
      eventAt: (seq) => events.get(seq),
      requestHeader: () => ({ config: { provider: 'test-provider', model: 'test-model' } }),
    },
  };
}

function contextReturning(text, calls) {
  return {
    llm: {
      stream(input) {
        calls.push(input);
        return (async function* () {
          yield { type: 'text-delta', index: 0, text };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    },
  };
}

const signal = new AbortController().signal;

test('only visible agent-instructions messages are supplied to the reviewer', async () => {
  const agent = agentWithInstructions([{ path: 'AGENTS.md', text: 'Use explicit task transitions.' }]);
  assert.deepEqual(activeProjectInstructions(agent), [{
    source: { kind: 'agent-instructions', path: 'AGENTS.md' },
    text: 'Use explicit task transitions.',
  }]);
  const calls = [];
  const result = await reviewTodoWrite(contextReturning('{"compliant":true}', calls), agent, { todos: ['Start task'] }, signal);
  assert.equal(result.status, 'passed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'test-provider');
  assert.equal(calls[0].model, 'test-model');
  assert.match(calls[0].messages[0].content[0].text, /Use explicit task transitions/);
  assert.doesNotMatch(calls[0].messages[0].content[0].text, /Not an AGENTS instruction/);
  assert.equal(calls[0].sessionId, undefined);
});

test('a violation returns a concise warning object', async () => {
  const agent = agentWithInstructions([{ path: 'AGENTS.md', text: 'Keep tasks sequential.' }]);
  const ctx = contextReturning('{"compliant":false,"message":"Run the required tests first."}', []);
  const result = await reviewTodoWrite(ctx, agent, { todos: ['Skip tests'] }, signal);
  assert.deepEqual(result, { status: 'warning', message: 'Run the required tests first.' });
});

test('missing project instructions avoid an unnecessary model call', async () => {
  const agent = agentWithInstructions([]);
  const calls = [];
  const result = await reviewTodoWrite(contextReturning('{"compliant":true}', calls), agent, { todos: ['Task'] }, signal);
  assert.equal(result.status, 'passed');
  assert.equal(calls.length, 0);
});

test('malformed reviewer output is rejected for the non-blocking tool wrapper', async () => {
  const agent = agentWithInstructions([{ path: 'AGENTS.md', text: 'Plan carefully.' }]);
  const ctx = contextReturning('not json', []);
  await assert.rejects(reviewTodoWrite(ctx, agent, { todos: ['Task'] }, signal), /JSON/);
});

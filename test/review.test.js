import test from 'node:test';
import assert from 'node:assert/strict';
import { activeProjectInstructions, reviewTodoWrite } from '../src/review.js';

function agentWithInstructions(instructions, stream) {
  const messages = instructions.map((instruction) => ({
    role: 'user',
    source: { kind: 'agent-instructions', path: instruction.path },
    content: [{ type: 'text', text: instruction.text }],
  }));
  messages.push({
    role: 'user',
    source: { kind: 'human' },
    content: [{ type: 'text', text: 'Not an AGENTS instruction' }],
  });
  return {
    session: {
      deriveMessages: () => messages,
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
  assert.equal(calls[0].maxTokens, 1024);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(calls[0].signal.aborted, false);
  assert.match(calls[0].messages[0].content[0].text, /Use explicit task transitions/);
  assert.doesNotMatch(calls[0].messages[0].content[0].text, /Not an AGENTS instruction/);
  assert.equal(calls[0].sessionId, undefined);
});

test('an aborted caller signal propagates to the reviewer stream', async () => {
  const agent = agentWithInstructions([{ path: 'AGENTS.md', text: 'Plan carefully.' }]);
  const calls = [];
  const controller = new AbortController();
  controller.abort();
  const result = await reviewTodoWrite(
    contextReturning('{"compliant":true}', calls),
    agent,
    { todos: ['Task'] },
    controller.signal,
  );
  assert.equal(result.status, 'passed');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(calls[0].signal.aborted, true);
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

test('a stalled reviewer is aborted by the timeout', async () => {
  const agent = agentWithInstructions([{ path: 'AGENTS.md', text: 'Plan carefully.' }]);
  let captured;
  const ctx = {
    llm: {
      stream(input) {
        captured = input;
        return (async function* () {
          if (input.signal.aborted) throw input.signal.reason;
          await new Promise((_resolve, reject) => {
            input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
          });
        })();
      },
    },
  };
  // AbortSignal.timeout() uses an unref'd timer; keep the test process alive
  // until it fires instead of letting the runner exit with a pending promise.
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    await assert.rejects(
      reviewTodoWrite(ctx, agent, { todos: ['Task'] }, signal, 50),
      (error) => error?.name === 'TimeoutError',
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(captured.signal.aborted, true);
});

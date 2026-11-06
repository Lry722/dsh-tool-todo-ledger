import { BlockAssembler } from '@deepseek-ai/dsh-llm';
import { REVIEW_POLICY, reviewError, reviewRequest, reviewResult } from './prompts.js';

const REVIEW_MAX_TOKENS = 1024;
const REVIEW_TIMEOUT_MS = 30_000;

export function activeProjectInstructions(agent) {
  const instructions = [];
  for (const seq of agent.session.surface.nodes) {
    const event = agent.session.eventAt(seq);
    if (event?.type !== 'user/message' || event.data.source.kind !== 'agent-instructions') continue;
    const text = event.data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (text.length > 0) instructions.push({ source: event.data.source, text });
  }
  return instructions;
}

function parseReview(text) {
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw reviewError('invalidObject');
  }
  const keys = Object.keys(value);
  if (value.compliant === true && keys.length === 1) {
    return { status: 'passed', message: reviewResult('passed') };
  }
  if (value.compliant === false && keys.length === 2 && typeof value.message === 'string' && value.message.trim()) {
    return { status: 'warning', message: value.message.trim() };
  }
  throw reviewError('invalidProtocol');
}

async function readReview(stream) {
  const assembler = new BlockAssembler();
  let finished = false;
  for await (const chunk of stream) {
    if (finished) throw reviewError('trailingData');
    assembler.push(chunk);
    if (chunk.type !== 'finish') continue;
    finished = true;
    if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
      throw reviewError('failed', {
        kind: chunk.reason.kind,
        message: chunk.reason.failure.message,
      });
    }
    if (chunk.reason.kind !== 'stop') throw reviewError('stoppedUnexpectedly', { kind: chunk.reason.kind });
  }
  if (!finished) throw reviewError('missingFinish');
  const blocks = assembler.blocks();
  const final = blocks.at(-1);
  if (final?.type !== 'text' || blocks.slice(0, -1).some((block) => block.type !== 'reasoning')) {
    throw reviewError('invalidBlocks');
  }
  return parseReview(final.text);
}

export async function reviewTodoWrite(ctx, agent, pending, signal) {
  const instructions = activeProjectInstructions(agent);
  if (instructions.length === 0) {
    return { status: 'passed', message: reviewResult('noInstructions') };
  }
  const header = agent.session.requestHeader();
  const route = header?.config;
  if (!route?.provider || !route?.model) throw reviewError('noRoute');
  const userText = reviewRequest(instructions, pending);
  const timeoutSignal = AbortSignal.timeout(REVIEW_TIMEOUT_MS);
  return readReview(ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    system: REVIEW_POLICY,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    maxTokens: REVIEW_MAX_TOKENS,
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  }));
}

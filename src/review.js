import { BlockAssembler } from '@deepseek-ai/dsh-llm';
import { REVIEW_POLICY, reviewRequest } from './prompts.js';

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
    throw new Error('reviewer output must be one JSON object');
  }
  const keys = Object.keys(value);
  if (value.compliant === true && keys.length === 1) {
    return { status: 'passed', message: 'No AGENTS.md violation found.' };
  }
  if (value.compliant === false && keys.length === 2 && typeof value.message === 'string' && value.message.trim()) {
    return { status: 'warning', message: value.message.trim() };
  }
  throw new Error('reviewer output does not match the response protocol');
}

async function readReview(stream) {
  const assembler = new BlockAssembler();
  let finished = false;
  for await (const chunk of stream) {
    if (finished) throw new Error('reviewer emitted data after its terminal finish');
    assembler.push(chunk);
    if (chunk.type !== 'finish') continue;
    finished = true;
    if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
      throw new Error(`reviewer ended with ${chunk.reason.kind}: ${chunk.reason.failure.message}`);
    }
    if (chunk.reason.kind !== 'stop') throw new Error(`reviewer ended with ${chunk.reason.kind}`);
  }
  if (!finished) throw new Error('reviewer emitted no terminal finish');
  const blocks = assembler.blocks();
  const final = blocks.at(-1);
  if (final?.type !== 'text' || blocks.slice(0, -1).some((block) => block.type !== 'reasoning')) {
    throw new Error('reviewer output must consist of optional reasoning blocks followed by exactly one text block');
  }
  return parseReview(final.text);
}

export async function reviewTodoWrite(ctx, agent, pending, signal) {
  const instructions = activeProjectInstructions(agent);
  if (instructions.length === 0) {
    return { status: 'passed', message: 'No active AGENTS.md instructions to review.' };
  }
  const header = agent.session.requestHeader();
  const route = header?.config;
  if (!route?.provider || !route?.model) throw new Error('no current model route is available');
  const userText = reviewRequest(instructions, pending);
  return readReview(ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    system: REVIEW_POLICY,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    signal,
  }));
}

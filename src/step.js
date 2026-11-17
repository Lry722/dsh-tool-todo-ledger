/** Helpers shared by the guard and tools for one assistant step's call list. */

/**
 * The tool-call blocks of one assistant message, or an empty list when the
 * message is unavailable or carries no content.
 * @param message - the assistant message to inspect.
 * @returns its tool-call blocks.
 */
export function stepToolCalls(message) {
  return message?.content?.filter((block) => block.type === 'tool-call') ?? [];
}

/**
 * Position of one logged call inside an already collected call list. Ids are
 * compared as strings so a numeric id from an execution still matches the
 * serialized id in the assistant message.
 * @param calls - the assistant message's tool-call blocks.
 * @param callId - the call to locate.
 * @returns its position, or -1 when the call is not part of this step.
 */
export function callPosition(calls, callId) {
  return calls.findIndex((call) => String(call.id) === String(callId));
}

/**
 * Parse one logged tool call's arguments. The runtime stores them as JSON text,
 * while tests and in-process callers may already pass an object.
 * @param call - the tool-call block to parse.
 * @returns the parsed arguments, or undefined when they cannot be parsed.
 */
export function callArguments(call) {
  const raw = call?.arguments;
  if (raw !== null && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return undefined;
  }
}

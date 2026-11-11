import { readFileSync } from 'node:fs';

function loadMarkdown(name) {
  return readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

// Prompt JSON is read at module evaluation rather than imported as a module, so
// the host HMR does not observe edits to prompts/*.json. Edit this module after
// editing one (or restart) to evict this module and its importers; a trivial
// comment change is enough.
function loadJson(name) {
  return JSON.parse(readFileSync(new URL(`../prompts/${name}.json`, import.meta.url), 'utf8'));
}

export function fillPrompt(template, values = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

export const REVIEW_POLICY = loadMarkdown('review-policy');
export const TOOL_PROMPTS = loadJson('tools');
export const GUARD_MESSAGES = loadJson('guard-messages');
export const LEDGER_MESSAGES = loadJson('ledger-errors');
export const TOOL_MESSAGES = loadJson('tool-messages');
export const NOTICES = loadJson('notices');
const REVIEW_REQUEST = loadMarkdown('review-request');
const REVIEW_RESULTS = loadJson('review-results');
const REVIEW_ERRORS = loadJson('review-errors');

export function reviewResult(kind, message) {
  return fillPrompt(REVIEW_RESULTS[kind], message === undefined ? {} : { message });
}

export function reviewError(kind, values) {
  return new Error(fillPrompt(REVIEW_ERRORS[kind], values));
}

export function reviewRequest(instructions, pending) {
  return fillPrompt(REVIEW_REQUEST, {
    instructions: JSON.stringify(instructions, null, 2),
    todoWrite: JSON.stringify(pending, null, 2),
  });
}

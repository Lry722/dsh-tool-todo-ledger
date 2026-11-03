import { readFileSync } from 'node:fs';

function loadPrompt(name) {
  return readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

export const REPORTING_SECTION = loadPrompt('reporting');
export const REVIEW_POLICY = loadPrompt('review-policy');
export const TOOL_PROMPTS = JSON.parse(readFileSync(new URL('../prompts/tools.json', import.meta.url), 'utf8'));
const REVIEW_REQUEST = loadPrompt('review-request');
const REVIEW_RESULTS = JSON.parse(readFileSync(new URL('../prompts/review-results.json', import.meta.url), 'utf8'));

export function reviewResult(kind, message) {
  return REVIEW_RESULTS[kind].replace('{{message}}', () => message);
}

export function reviewRequest(instructions, pending) {
  return REVIEW_REQUEST.replace(/\{\{(instructions|todoWrite)\}\}/g, (_match, key) => (
    JSON.stringify(key === 'instructions' ? instructions : pending, null, 2)
  ));
}

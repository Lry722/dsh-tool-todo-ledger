import { readFileSync } from 'node:fs';

/**
 * Read one prompt JSON resource from `prompts/`.
 * @param name - resource name without the `.json` suffix.
 * @returns the parsed resource.
 */
function loadJson(name) {
  // Prompt JSON is read at module evaluation, so the host HMR does not observe
  // edits to prompts/*.json. Touch this module after editing one (or restart) to
  // evict this module and its importers. A comment change is enough.
  return JSON.parse(readFileSync(new URL(`../prompts/${name}.json`, import.meta.url), 'utf8'));
}

export function fillPrompt(template, values = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

export const TOOL_PROMPTS = loadJson('tools');
export const GUARD_MESSAGES = loadJson('guard-messages');
export const LEDGER_MESSAGES = loadJson('ledger-errors');
export const TOOL_MESSAGES = loadJson('tool-messages');
export const NOTICES = loadJson('notices');

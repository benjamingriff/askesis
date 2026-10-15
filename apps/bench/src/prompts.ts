import { createHash } from 'node:crypto';
import { REVIEW_PROMPT, REVIEW_VERSION, SIMULATOR_PROMPT, SIMULATOR_VERSION } from './models.js';
import { VOICE_PROMPT, VOICE_VERSION } from './voice.js';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Every evaluator prompt as name and exact text. Changing a text requires a new name. */
export const EVALUATOR_PROMPTS = {
  simulator: { name: SIMULATOR_VERSION, text: SIMULATOR_PROMPT },
  voice: { name: VOICE_VERSION, text: VOICE_PROMPT },
  reviewer: { name: REVIEW_VERSION, text: REVIEW_PROMPT },
} as const;

export function promptIdentity(prompt: { name: string; text: string }) {
  return { name: prompt.name, hash: sha256(prompt.text) };
}

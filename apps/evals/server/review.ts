import {
  COMMUNICATION_ASPECTS,
  CRITERIA,
  type Highlight,
  type HumanReview,
  type HumanVerdict,
} from '../src/types';
import { asNumber, asString, asStrings, isObject, objects } from './json';

// Human reviews are the ground truth the model reviewer is eventually calibrated
// against. They are written beside the run's other artifacts so they travel with
// the evidence they judge.

export const REVIEW_FILE = 'human-review.json';
export const HIGHLIGHTS_FILE = 'human-highlights.json';

const VERDICTS = new Set<HumanVerdict>(['fit', 'needs_revision', 'unfit']);
const MAX_NOTES = 10_000;
const MAX_TAGS = 24;

/** Returns a normalized review, or null when the payload is not a review. */
export function parseReview(value: unknown, now = new Date()): HumanReview | null {
  if (!isObject(value)) return null;
  const verdict = asString(value.verdict);
  const criteria: HumanReview['criteria'] = {};
  if (isObject(value.criteria)) {
    for (const criterion of CRITERIA) {
      const agreement = value.criteria[criterion];
      if (agreement === 'agree' || agreement === 'disagree') criteria[criterion] = agreement;
    }
  }
  return {
    updatedAt: asString(value.updatedAt) ?? now.toISOString(),
    verdict:
      verdict !== null && VERDICTS.has(verdict as HumanVerdict) ? (verdict as HumanVerdict) : null,
    criteria,
    tags: [
      ...new Set(
        asStrings(value.tags)
          .map((tag) => tag.trim().slice(0, 48))
          .filter(Boolean),
      ),
    ].slice(0, MAX_TAGS),
    notes: (asString(value.notes) ?? '').slice(0, MAX_NOTES),
    communication: Object.fromEntries(
      COMMUNICATION_ASPECTS.map((aspect) => {
        const rating = isObject(value.communication) ? asNumber(value.communication[aspect]) : null;
        return [
          aspect,
          rating !== null && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
        ];
      }),
    ) as HumanReview['communication'],
  };
}

const MAX_HIGHLIGHTS = 200;

/** Returns valid highlights, or null when the payload is not a list. */
export function parseHighlights(value: unknown, now = new Date()): Highlight[] | null {
  if (!Array.isArray(value)) return null;
  return objects(value)
    .flatMap((item) => {
      const sequence = asNumber(item.sequence);
      const quote = (asString(item.quote) ?? '').trim().slice(0, 600);
      const tag = (asString(item.tag) ?? '').trim().toLowerCase().slice(0, 48);
      if (sequence === null || !Number.isInteger(sequence) || !quote || !tag) return [];
      return [{ sequence, quote, tag, createdAt: asString(item.createdAt) ?? now.toISOString() }];
    })
    .slice(0, MAX_HIGHLIGHTS);
}

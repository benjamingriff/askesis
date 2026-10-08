import type { BlockPhase, TrainingBlock } from '@askesis/api-client';
import { KIND_COLORS, PHASE_COLORS } from '../theme/palette';
import { addDays, daysBetween } from './format';

export const PHASE_META: Record<BlockPhase, { label: string; description: string }> = {
  base: { label: 'Base', description: 'Aerobic volume and durability, little intensity.' },
  build: { label: 'Build', description: 'Progressively harder threshold and interval work.' },
  peak: { label: 'Peak', description: 'The most race-specific training, sharpening for the goal.' },
  taper: { label: 'Taper', description: 'Less volume with intensity kept, to arrive fresh.' },
  recovery: { label: 'Recovery', description: 'Easy training to absorb the work before.' },
};

export type PlanBlock = TrainingBlock & { label: string; color: string };

/**
 * Labels blocks by phase, numbering a phase the plan repeats (Build 1, Build 2). Blocks written
 * before phases existed keep their title and a neutral colour.
 */
export function labelBlocks(blocks: TrainingBlock[]): PlanBlock[] {
  const totals = new Map<BlockPhase, number>();
  for (const block of blocks)
    if (block.phase) totals.set(block.phase, (totals.get(block.phase) ?? 0) + 1);
  const seen = new Map<BlockPhase, number>();
  return blocks.map((block) => {
    if (!block.phase) return { ...block, label: block.title, color: KIND_COLORS.rest };
    const ordinal = (seen.get(block.phase) ?? 0) + 1;
    seen.set(block.phase, ordinal);
    const name = PHASE_META[block.phase].label;
    return {
      ...block,
      label: totals.get(block.phase)! > 1 ? `${name} ${ordinal}` : name,
      color: PHASE_COLORS[block.phase],
    };
  });
}

/** Labelled blocks, or none when no block names a phase: such plans have no shape to show. */
export function phasedBlocks(blocks: TrainingBlock[]): PlanBlock[] {
  return blocks.some((block) => block.phase) ? labelBlocks(blocks) : [];
}

/** The block covering most of a range's days (a calendar week), or null when none overlaps. */
export function blockFor<T extends TrainingBlock>(
  blocks: readonly T[],
  range: { startDate: string; endDate: string },
): T | null {
  let best: T | null = null;
  let bestDays = 0;
  for (const block of blocks) {
    const start = block.startDate > range.startDate ? block.startDate : range.startDate;
    const end = block.endDate < range.endDate ? block.endDate : range.endDate;
    const days = end >= start ? daysBetween(start, end) + 1 : 0;
    if (days > bestDays) {
      best = block;
      bestDays = days;
    }
  }
  return best;
}

export type TimelineSegment =
  | { kind: 'block'; block: PlanBlock; days: number }
  | { kind: 'gap'; startDate: string; endDate: string; days: number };

/**
 * Blocks laid end to end across the whole plan, sized by days. Plan dates the coach has not yet
 * organised into blocks become gaps, so a partly generated plan shows what remains.
 */
export function timeline(
  blocks: PlanBlock[],
  startDate: string | null,
  endDate: string | null,
): { segments: TimelineSegment[]; startDate: string; days: number } | null {
  const sorted = [...blocks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const first = [startDate, sorted[0]?.startDate].filter(Boolean).sort()[0];
  const last = [endDate, ...sorted.map((block) => block.endDate)].filter(Boolean).sort().at(-1);
  if (!first || !last) return null;
  const segments: TimelineSegment[] = [];
  let cursor = first;
  const gap = (until: string) => {
    if (until <= cursor) return;
    const end = addDays(until, -1);
    segments.push({
      kind: 'gap',
      startDate: cursor,
      endDate: end,
      days: daysBetween(cursor, end) + 1,
    });
  };
  for (const block of sorted) {
    if (block.endDate < cursor) continue;
    gap(block.startDate);
    const start = block.startDate > cursor ? block.startDate : cursor;
    segments.push({ kind: 'block', block, days: daysBetween(start, block.endDate) + 1 });
    cursor = addDays(block.endDate, 1);
  }
  gap(addDays(last, 1));
  return { segments, startDate: first, days: daysBetween(first, last) + 1 };
}

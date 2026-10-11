import type { RunSummary, Verdict } from '../types';
import { promptKey } from './cohorts';
import { median } from './format';
import { modelName, reasoningRank } from './models';

export interface Filters {
  hiddenModels: string[];
  hiddenReasoning: string[];
  hiddenVerdicts: Verdict[];
  hiddenScenarios: string[];
  hiddenPrompts: string[];
  search: string;
}

export const EMPTY_FILTERS: Filters = {
  hiddenModels: [],
  hiddenReasoning: [],
  hiddenVerdicts: [],
  hiddenScenarios: [],
  hiddenPrompts: [],
  search: '',
};

export function isFiltered(filters: Filters): boolean {
  return (
    filters.hiddenModels.length > 0 ||
    filters.hiddenReasoning.length > 0 ||
    filters.hiddenVerdicts.length > 0 ||
    filters.hiddenScenarios.length > 0 ||
    filters.hiddenPrompts.length > 0 ||
    filters.search.trim() !== ''
  );
}

export function applyFilters(runs: RunSummary[], filters: Filters): RunSummary[] {
  const query = filters.search.trim().toLowerCase();
  return runs.filter((run) => {
    if (filters.hiddenModels.includes(run.coachModel)) return false;
    if (filters.hiddenReasoning.includes(run.reasoning)) return false;
    if (filters.hiddenVerdicts.includes(run.verdict)) return false;
    if (filters.hiddenScenarios.includes(run.scenarioId)) return false;
    if (filters.hiddenPrompts.includes(promptKey(run))) return false;
    if (query === '') return true;
    return [
      run.id,
      run.coachModel,
      modelName(run.coachModel),
      run.scenarioId,
      run.planTitle ?? '',
      run.stopReason ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function countBy<T extends string>(
  runs: RunSummary[],
  key: (run: RunSummary) => T,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const run of runs) counts.set(key(run), (counts.get(key(run)) ?? 0) + 1);
  return counts;
}

export interface Variant {
  key: string;
  model: string;
  reasoning: string;
  runs: RunSummary[];
  demo: boolean;
}

/** Runs grouped by coach model and reasoning effort, the unit compared across charts. */
export function variants(runs: RunSummary[]): Variant[] {
  const map = new Map<string, Variant>();
  for (const run of runs) {
    const key = `${run.coachModel}::${run.reasoning}`;
    const existing = map.get(key);
    if (existing) {
      existing.runs.push(run);
      existing.demo = existing.demo && run.demo;
    } else {
      map.set(key, {
        key,
        model: run.coachModel,
        reasoning: run.reasoning,
        runs: [run],
        demo: run.demo,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.model.localeCompare(b.model) || reasoningRank(a.reasoning) - reasoningRank(b.reasoning),
  );
}

export function coachTokens(run: RunSummary): number {
  return run.tokens.coachInput + run.tokens.coachOutput;
}

export function medianOf(
  runs: RunSummary[],
  pick: (run: RunSummary) => number | null,
): number | null {
  return median(runs.map(pick).filter((value): value is number => value !== null));
}

/**
 * A run with a final assessment. Unfinished runs stay visible in lists and the
 * verdict mix but are excluded from outcome estimates, where they would count as
 * failures before their outcome exists.
 */
export function isFinished(run: RunSummary): boolean {
  return run.verdict !== 'running';
}

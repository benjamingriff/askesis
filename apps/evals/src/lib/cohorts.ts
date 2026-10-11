import type { RunSummary } from '../types';
import { modelName } from './models';

export type Dimension = 'prompt' | 'model' | 'reasoning' | 'variant' | 'revision' | 'scenario';

export const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'model', label: 'Model' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'variant', label: 'Model + reasoning' },
  { id: 'revision', label: 'Revision' },
  { id: 'scenario', label: 'Scenario' },
];

export function promptKey(run: RunSummary): string {
  const version = run.promptVersion ?? 'unknown prompt';
  return run.promptHash ? `${version} · ${run.promptHash}` : version;
}

export function cohortKey(run: RunSummary, dimension: Dimension): string {
  switch (dimension) {
    case 'prompt':
      return promptKey(run);
    case 'model':
      return run.coachModel;
    case 'reasoning':
      return run.reasoning;
    case 'variant':
      return `${run.coachModel} · ${run.reasoning}`;
    case 'revision':
      return `${run.revision ?? 'unknown'}${run.workingTreeDirty ? '*' : ''}`;
    case 'scenario':
      return run.scenarioId;
  }
}

export function cohortLabel(key: string, dimension: Dimension): string {
  if (dimension === 'model') return modelName(key);
  if (dimension === 'variant') {
    const [model, reasoning] = key.split(' · ');
    return `${modelName(model ?? key)} · ${reasoning ?? ''}`;
  }
  return key;
}

/** Cohorts ordered by most recent run, so the newest candidate sorts first. */
export function cohorts(
  runs: RunSummary[],
  dimension: Dimension,
): { key: string; runs: RunSummary[]; latest: string }[] {
  const map = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const key = cohortKey(run, dimension);
    map.set(key, [...(map.get(key) ?? []), run]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      runs: list,
      latest: list.reduce((latest, run) => (run.startedAt > latest ? run.startedAt : latest), ''),
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

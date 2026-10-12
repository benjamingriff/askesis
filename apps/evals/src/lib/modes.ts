import type { FlagSeverity, RunSummary } from '../types';
import { humanize } from './format';

// A failure mode is anything that went wrong in a run, normalized so the same
// problem counts once per run regardless of whether a check, the reviewer, a
// transcript flag or a human spotted it.

export type ModeSource = 'flag' | 'check' | 'criterion' | 'stop' | 'human';

export interface FailureMode {
  key: string;
  label: string;
  source: ModeSource;
  severity: FlagSeverity;
}

export const SOURCE_LABEL: Record<ModeSource, string> = {
  flag: 'Transcript',
  check: 'Exact check',
  criterion: 'Reviewer',
  stop: 'Execution',
  human: 'Human',
};

export function modesOf(run: RunSummary): FailureMode[] {
  const modes = new Map<string, FailureMode>();
  const add = (mode: FailureMode) => {
    if (!modes.has(mode.key)) modes.set(mode.key, mode);
  };
  if (run.stopReason && run.stopReason !== 'completed') {
    add({
      key: `stop:${run.stopReason}`,
      label: `Stopped: ${run.stopReason.toLowerCase().replace(/_/g, ' ')}`,
      source: 'stop',
      severity: 'critical',
    });
  }
  for (const check of run.checks) {
    if (check.status === 'fail')
      add({
        key: `check:${check.id}`,
        label: `${humanize(check.id)} check failed`,
        source: 'check',
        severity: 'critical',
      });
  }
  for (const criterion of run.criteria) {
    if (criterion.result !== 'pass') {
      add({
        key: `criterion:${criterion.criterion}:${criterion.result}`,
        label: `Reviewer ${criterion.result === 'fail' ? 'failed' : 'unsure about'} ${humanize(criterion.criterion).toLowerCase()}`,
        source: 'criterion',
        severity: criterion.result === 'fail' ? 'critical' : 'warning',
      });
    }
  }
  for (const flag of run.flags) {
    add({
      key: `flag:${flag.kind}`,
      label: flag.kindLabel,
      source: 'flag',
      severity: flag.severity,
    });
  }
  if (run.review?.verdict && run.review.verdict !== 'fit') {
    add({
      key: `human:${run.review.verdict}`,
      label: `You judged ${humanize(run.review.verdict).toLowerCase()}`,
      source: 'human',
      severity: 'critical',
    });
  }
  for (const tag of run.review?.tags ?? []) {
    if (tag !== 'exemplary')
      add({ key: `tag:${tag}`, label: `Tagged “${tag}”`, source: 'human', severity: 'warning' });
  }
  return [...modes.values()];
}

export interface ModeCount extends FailureMode {
  runs: string[];
}

export function countModes(runs: RunSummary[]): ModeCount[] {
  const counts = new Map<string, ModeCount>();
  for (const run of runs) {
    for (const mode of modesOf(run)) {
      const entry = counts.get(mode.key) ?? { ...mode, runs: [] };
      entry.runs.push(run.id);
      counts.set(mode.key, entry);
    }
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return [...counts.values()].sort(
    (a, b) => b.runs.length - a.runs.length || order[a.severity] - order[b.severity],
  );
}

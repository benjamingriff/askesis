import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import type { Scenario } from './scenario.js';
import { addDays } from './scenario.js';
import type { Review } from './models.js';

export type Check = {
  id: string;
  status: 'pass' | 'fail';
  explanation: string;
  evidence: string[];
};
type Step = NonNullable<BenchmarkSnapshot['plan']>['workouts'][number]['prescription'];
function efforts(step: Step): Step[] {
  return step.kind === 'effort' ? [step] : step.steps.flatMap(efforts);
}
export function hasExpectedCoverage(snapshot: BenchmarkSnapshot, scenario: Scenario) {
  const ranges = (snapshot.plan?.brief.coverage ?? [])
    .filter((range) => range.current)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  let cursor = scenario.dates.startDate;
  for (const range of ranges) {
    if (range.startDate > cursor) break;
    if (range.endDate >= cursor) cursor = addDays(range.endDate, 1);
  }
  return cursor > scenario.dates.coverageEndDate && (snapshot.plan?.workouts.length ?? 0) > 0;
}

export function checkPlan(
  snapshot: BenchmarkSnapshot,
  scenario: Scenario,
  disclosed: string[],
): Check[] {
  const plan = snapshot.plan;
  const check = (
    id: string,
    pass: boolean,
    explanation: string,
    evidence: string[] = [],
  ): Check => ({ id, status: pass ? 'pass' : 'fail', explanation, evidence });
  const checks = [
    check('plan_saved', plan !== null, plan ? 'A plan was persisted.' : 'No plan was persisted.'),
  ];
  if (!plan) return checks;
  const workouts = plan.workouts.map(({ workout }) => workout);
  const refs = workouts.map((workout) => `workout:${workout.id}`);
  const inHorizon = workouts.filter(
    (workout) =>
      workout.scheduledDate >= scenario.dates.startDate &&
      workout.scheduledDate <= scenario.dates.coverageEndDate,
  );
  const baseline = plan.brief.brief.sports.find((sport) => sport.sport === 'run');
  checks.push(
    check(
      'required_discovery',
      ['dates', 'training', 'frequency', 'availability', 'fitness'].every((id) =>
        disclosed.includes(id),
      ),
      'Required planning facts were disclosed before completion.',
    ),
    check(
      'plan_dates',
      plan.header.draft?.startDate === scenario.dates.startDate &&
        plan.header.draft?.endDate === scenario.dates.eventDate,
      'Overall dates should cover the twelve-week goal.',
      ['plan:brief'],
    ),
    check(
      'coverage',
      hasExpectedCoverage(snapshot, scenario),
      'The agreed four-week horizon must have current saved coverage, including rest days.',
      ['plan:brief'],
    ),
    check(
      'structure',
      !plan.findings.some((finding) => finding.severity === 'error'),
      'Existing aggregate validation must have no structural errors.',
      plan.findings
        .filter((finding) => finding.severity === 'error')
        .map((finding) => finding.path),
    ),
    check(
      'running_only',
      workouts.every((workout) => workout.discipline === 'run') &&
        plan.brief.brief.sports.length === 1 &&
        baseline !== undefined,
      'This scenario trains running only.',
      refs,
    ),
    check(
      'baseline',
      baseline?.sport === 'run' &&
        baseline.currentSessions.value === 3 &&
        baseline.desiredSessions === scenario.expectations.sessionsPerWeek &&
        baseline.weeklyDistance.value === scenario.expectations.weeklyDistanceMetres &&
        baseline.longestDistance.value === scenario.expectations.longestDistanceMetres,
      'The saved brief should match the disclosed training baseline.',
      ['plan:brief'],
    ),
    check(
      'available_days',
      workouts.every((workout) =>
        scenario.expectations.availableWeekdays.includes(
          new Date(`${workout.scheduledDate}T12:00:00Z`).getUTCDay() || 7,
        ),
      ),
      'Workouts must occur only on Tuesday, Thursday or Sunday.',
      refs,
    ),
    check(
      'daily_limit',
      workouts.every(
        (workout) =>
          workouts.filter((other) => other.scheduledDate === workout.scheduledDate).length <= 2,
      ),
      'At most two workouts may be scheduled on a day.',
      refs,
    ),
    check(
      'weekly_frequency',
      Array.from({ length: scenario.expectations.planningWeeks }, (_, index) => {
        const start = addDays(scenario.dates.startDate, index * 7);
        return (
          inHorizon.filter(
            (workout) =>
              workout.scheduledDate >= start && workout.scheduledDate <= addDays(start, 6),
          ).length === scenario.expectations.sessionsPerWeek
        );
      }).every(Boolean),
      'Each prescribed week should contain the requested three runs.',
      refs,
    ),
    check(
      'prescriptions',
      plan.workouts.every(
        ({ prescription }) =>
          efforts(prescription).length > 0 &&
          efforts(prescription).every(
            (effort) =>
              effort.completion !== null &&
              effort.targets.some(
                (target) =>
                  target.type === 'zone' &&
                  target.zoneSystem === 'run_pace' &&
                  target.resolvedZone !== null,
              ),
          ),
      ),
      'Every running effort should have a completion and a resolved running zone.',
      refs,
    ),
    check(
      'calibration_evidence',
      snapshot.performance.current.some(
        (entry) =>
          entry.system === 'run_pace' &&
          entry.provenance === 'user_supplied' &&
          entry.observedOn === scenario.dates.observedOn &&
          entry.input.method === 'race_result' &&
          entry.input.distanceMetres === scenario.expectations.raceDistanceMetres &&
          entry.input.durationSeconds === scenario.expectations.raceDurationSeconds,
      ),
      'Calibration should use the disclosed 5 km result with its date and measured provenance.',
      ['plan:brief'],
    ),
  );
  return checks;
}

export function overallVerdict(checks: Check[], review: Review | null, stopReason: string) {
  if (
    stopReason !== 'completed' ||
    checks.some(
      (check) =>
        ['plan_saved', 'coverage', 'prescriptions'].includes(check.id) && check.status === 'fail',
    )
  )
    return 'incomplete';
  if (!review) return 'assessment_unavailable';
  if (
    checks.some((check) => check.status === 'fail') ||
    review.criteria.some((criterion) => criterion.result !== 'pass')
  )
    return 'needs_revision';
  return review.verdict;
}

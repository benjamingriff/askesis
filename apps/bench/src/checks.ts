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
type Plan = NonNullable<BenchmarkSnapshot['plan']>;
type Step = Plan['workouts'][number]['prescription'];
type Workout = Plan['workouts'][number]['workout'];
const ZONE_SYSTEM = { run: 'run_pace', cycle: 'cycle_power', swim: 'swim_pace' } as const;
/** Checks that make a plan unusable, so the run is incomplete rather than needing revision. */
const BLOCKING = ['saved_plan', 'coverage', 'prescriptions'];

function efforts(step: Step): Step[] {
  return step.kind === 'effort' ? [step] : step.steps.flatMap(efforts);
}
/** ISO weekday, Monday 1 to Sunday 7. */
export function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}
/** The sports a workout trains: its own, or each effort's in a mixed workout. */
function workoutSports(workout: Workout, prescription: Step) {
  return new Set(efforts(prescription).map((effort) => effort.discipline ?? workout.discipline));
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

const sameAnswer = (answer: { status: string; value: number | null }, expected: number | null) =>
  expected === null
    ? answer.status === 'unknown'
    : answer.status === 'known' && answer.value === expected;

/** Compares the saved brief with every sport baseline the athlete disclosed. */
function baselineMatches(plan: Plan, scenario: Scenario) {
  return scenario.persona.sports.every((expected) => {
    const saved = plan.brief.brief.sports.find((sport) => sport.sport === expected.sport);
    if (!saved || saved.desiredSessions !== expected.desiredSessions) return false;
    if (!sameAnswer(saved.currentSessions, expected.currentSessions)) return false;
    if (saved.sport === 'cycle' && expected.sport === 'cycle')
      return (
        sameAnswer(saved.weeklyDuration, expected.weeklyDurationSeconds) &&
        sameAnswer(saved.longestDuration, expected.longestDurationSeconds)
      );
    if (
      (saved.sport === 'run' || saved.sport === 'swim') &&
      (expected.sport === 'run' || expected.sport === 'swim')
    )
      return (
        sameAnswer(saved.weeklyDistance, expected.weeklyDistanceMetres) &&
        sameAnswer(saved.longestDistance, expected.longestDistanceMetres)
      );
    return saved.sport === 'strength';
  });
}

function prescriptionComplete(workout: Workout, prescription: Step) {
  const steps = efforts(prescription);
  return (
    steps.length > 0 &&
    steps.every((effort) => {
      if (effort.completion === null) return false;
      const sport = effort.discipline ?? workout.discipline;
      if (sport === 'run' || sport === 'cycle' || sport === 'swim')
        return effort.targets.some(
          (target) =>
            target.type === 'zone' &&
            target.zoneSystem === ZONE_SYSTEM[sport] &&
            target.resolvedZone !== null,
        );
      if (sport === 'strength')
        return (
          (effort.role === 'recovery' && effort.completion.type === 'duration') ||
          (effort.completion.type === 'repetitions' &&
            effort.targets.some((target) => target.type === 'rir' || target.type === 'rpe'))
        );
      return effort.targets.length > 0;
    })
  );
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
    check('saved_plan', plan !== null, plan ? 'A plan was persisted.' : 'No plan was persisted.'),
  ];
  if (!plan) return checks;
  const persona = scenario.persona;
  const workouts = plan.workouts;
  const refs = (items: typeof workouts) => items.map(({ workout }) => `workout:${workout.id}`);
  const known = new Set([...scenario.openingFactIds, ...disclosed]);
  const sports = new Set(persona.sports.map((sport) => sport.sport));
  const slot = (date: string) => persona.availability.find((day) => day.weekday === weekday(date));
  const byDate = new Map<string, typeof workouts>();
  for (const item of workouts)
    byDate.set(item.workout.scheduledDate, [
      ...(byDate.get(item.workout.scheduledDate) ?? []),
      item,
    ]);
  const missing = scenario.expectations.requiredDiscovery.filter((id) => !known.has(id));
  const candidates: Record<string, () => Check> = {
    plan_dates: () =>
      check(
        'plan_dates',
        plan.header.draft?.startDate === scenario.dates.startDate &&
          plan.header.draft?.endDate === scenario.dates.endDate,
        `Overall dates should span the ${scenario.planSpanWeeks}-week plan, ${scenario.dates.startDate} to ${scenario.dates.endDate}.`,
        ['plan:brief'],
      ),
    coverage: () =>
      check(
        'coverage',
        hasExpectedCoverage(snapshot, scenario),
        `The first ${scenario.prescriptionWeeks} weeks must have current saved coverage, including rest days.`,
        ['plan:brief'],
      ),
    sports: () => {
      const saved = new Set(plan.brief.brief.sports.map((sport) => sport.sport));
      const extra = workouts.filter(({ workout, prescription }) =>
        [...workoutSports(workout, prescription)].some(
          (sport) => !sports.has(sport as never) && sport !== 'other',
        ),
      );
      return check(
        'sports',
        saved.size === sports.size &&
          [...sports].every((sport) => saved.has(sport)) &&
          !extra.length,
        `The brief and workouts should train only ${[...sports].join(', ')}.`,
        extra.length ? refs(extra) : ['plan:brief'],
      );
    },
    baseline: () =>
      check(
        'baseline',
        baselineMatches(plan, scenario),
        'The saved brief should match each disclosed sport baseline, keeping unknown values unknown.',
        ['plan:brief'],
      ),
    availability: () => {
      const outside = workouts.filter(({ workout, prescription }) => {
        if (!slot(workout.scheduledDate)) return true;
        return persona.accessRestrictions.some(
          (access) =>
            workoutSports(workout, prescription).has(access.sport) &&
            !access.weekdays.includes(weekday(workout.scheduledDate)),
        );
      });
      const days = plan.brief.brief.weekdays.map((value, index) =>
        persona.availability.some((day) => day.weekday === index + 1)
          ? value !== 'unavailable'
          : value === 'unavailable',
      );
      return check(
        'availability',
        !outside.length && days.every(Boolean),
        'Workouts should fall only on available days, and facility sports only on their facility days.',
        outside.length ? refs(outside) : ['plan:brief'],
      );
    },
    time_budgets: () => {
      const over = workouts.filter(({ workout, prescription }) => {
        const day = byDate.get(workout.scheduledDate) ?? [];
        if (day.some(({ workout }) => workout.estimatedDurationSeconds === null)) return true;
        const total = day.reduce((sum, item) => sum + item.workout.estimatedDurationSeconds!, 0);
        if (total > (slot(workout.scheduledDate)?.maxMinutes ?? 0) * 60) return true;
        const trained = workoutSports(workout, prescription);
        return persona.accessRestrictions.some(
          (access) =>
            trained.size === 1 &&
            trained.has(access.sport) &&
            workout.estimatedDurationSeconds! > access.maxMinutes * 60,
        );
      });
      return check(
        'time_budgets',
        !over.length,
        "Each day's estimated training should fit its time limit, including facility limits.",
        refs(over),
      );
    },
    daily_limit: () => {
      const crowded = workouts.filter(
        ({ workout }) => (byDate.get(workout.scheduledDate)?.length ?? 0) > 2,
      );
      return check(
        'daily_limit',
        !crowded.length,
        'At most two workouts may be scheduled on a day.',
        refs(crowded),
      );
    },
    prescriptions: () => {
      const incomplete = workouts.filter(
        ({ workout, prescription }) => !prescriptionComplete(workout, prescription),
      );
      return check(
        'prescriptions',
        !incomplete.length,
        'Every effort needs a completion; run, ride and swim efforts a resolved zone; strength work reps with RIR or RPE, with timed rests allowed.',
        refs(incomplete),
      );
    },
    performance_provenance: () => {
      const current = snapshot.performance.current;
      const measured = scenario.evidence.every((evidence) =>
        current.some(
          (entry) =>
            entry.system === evidence.system &&
            entry.provenance === 'user_supplied' &&
            entry.observedOn === evidence.observedOn &&
            JSON.stringify(entry.input) === JSON.stringify(evidence.input),
        ),
      );
      // Without evidence, any calibration must be labelled as an estimate.
      const honest = current.every(
        (entry) =>
          entry.provenance !== 'user_supplied' ||
          scenario.evidence.some((evidence) => evidence.system === entry.system),
      );
      return check(
        'performance_provenance',
        measured && honest,
        scenario.evidence.length
          ? 'Calibrations should record the disclosed results with their dates as user supplied; others must be labelled estimates.'
          : 'No results were disclosed, so any calibration must be labelled an estimate.',
        ['plan:brief'],
      );
    },
  };
  checks.push(
    check(
      'required_discovery',
      !missing.length,
      missing.length
        ? `Not disclosed before completion: ${missing.join(', ')}.`
        : 'Required planning facts were disclosed before completion.',
    ),
    check(
      'structure',
      !plan.findings.some((finding) => finding.severity === 'error'),
      'Existing aggregate validation must have no structural errors.',
      plan.findings
        .filter((finding) => finding.severity === 'error')
        .map((finding) => finding.path),
    ),
  );
  for (const id of scenario.expectations.checks) {
    const candidate = candidates[id];
    if (candidate) checks.push(candidate());
    else if (id !== 'saved_plan') throw new Error(`Unknown check ${id}.`);
  }
  return checks;
}

export function overallVerdict(checks: Check[], review: Review | null, stopReason: string) {
  if (
    stopReason !== 'completed' ||
    checks.some((check) => BLOCKING.includes(check.id) && check.status === 'fail')
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

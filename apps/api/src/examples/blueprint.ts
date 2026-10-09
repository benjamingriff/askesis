import { createHash } from 'node:crypto';
import type { Insertable } from 'kysely';
import type { DB } from '../database/generated.js';
import { localDate } from '../modules/athletes/timezone.js';
import { emptyBrief, type Brief, type SportBaseline } from '../modules/plans/brief.schemas.js';
import type { StepDiscipline, WorkoutDiscipline } from '../modules/plans/disciplines.js';
import type { BlockPhase, RacePriority } from '../modules/plans/periodization.js';

export const EXAMPLE_KINDS = ['cycling', 'triathlon', 'strength-hiit'] as const;
export type ExampleKind = (typeof EXAMPLE_KINDS)[number];
export type Completion = Omit<Insertable<DB['step_completions']>, 'step_id' | 'plan_version_id'>;
export type Target = Omit<
  Insertable<DB['step_targets']>,
  'id' | 'step_id' | 'plan_version_id' | 'position' | 'lineage_id'
>;
export type Step = {
  label: string;
  kind?: 'sequence' | 'repeat';
  role?: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'transition' | 'main' | 'other';
  sport?: StepDiscipline;
  instructions?: string;
  movement?: string;
  repeat?: number;
  completion?: Completion;
  targets?: Target[];
  steps?: Step[];
};
export type Session = {
  title: string;
  sport: WorkoutDiscipline;
  purpose: string;
  minutes: number;
  metres?: number;
  tags: string[];
  steps: Step[];
  race?: RacePriority;
};
export type WeekTarget = {
  metric: 'distance' | 'duration' | 'strength_session_count';
  discipline: WorkoutDiscipline;
  target: number;
  unit: 'metres' | 'seconds' | 'sessions';
};
export const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Stable within the athlete's calendar week, with one past week to inspect. */
export function exampleAnchor(timezone: string, now = new Date()) {
  const today = localDate(timezone, now);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  return shiftDay(today, -weekday - 7);
}
const duration = (seconds: number): Completion => ({
  completion_type: 'duration',
  numeric_value: seconds,
  unit: 'seconds',
});
const distance = (metres: number): Completion => ({
  completion_type: 'distance',
  numeric_value: metres,
  unit: 'metres',
});
const reps = (value: number): Completion => ({
  completion_type: 'repetitions',
  numeric_value: value,
  unit: 'repetitions',
});
const numeric = (target_type: string, value: number, unit: string): Target => ({
  target_type,
  target_value: value,
  unit,
});
const instruction = (text_value: string): Target => ({ target_type: 'instruction', text_value });
const zone = (sport: 'run' | 'cycle' | 'swim', zone_key: string): Target => ({
  target_type: 'zone',
  zone_system: sport === 'run' ? 'run_pace' : sport === 'cycle' ? 'cycle_power' : 'swim_pace',
  zone_key,
});
const effort = (
  label: string,
  sport: StepDiscipline,
  completion: Completion,
  targets: Target[] = [],
  role: Step['role'] = 'work',
): Step => ({ label, sport, completion, targets, role });
const rest = (seconds = 90) =>
  effort('Recover and reset', 'other', duration(seconds), [], 'recovery');
const repeat = (label: string, count: number, steps: Step[]): Step => ({
  label,
  kind: 'repeat',
  repeat: count,
  steps,
});

/** Four-week waves: three progressive weeks followed by reduced volume. */
const progression = (week: number) => 1 + Math.floor(week / 4) * 0.12 + (week % 4) * 0.06;
const isLight = (week: number) => week % 4 === 3;
const minutesFor = (base: number, week: number) =>
  Math.round(base * (isLight(week) ? 0.65 : progression(week)));

function ride(week: number, type: 'easy' | 'quality' | 'long'): Session {
  const light = isLight(week);
  const minutes = minutesFor(type === 'long' ? 105 : type === 'quality' ? 60 : 45, week);
  const sets = light ? 2 : week < 4 ? 3 : 4;
  const work = week < 4 ? 300 : week < 8 ? 420 : 480;
  return {
    title:
      type === 'long'
        ? 'Long endurance ride'
        : type === 'easy'
          ? 'Easy spin and cadence'
          : light
            ? 'Reduced sweet spot intervals'
            : week < 4
              ? 'Tempo foundation intervals'
              : week < 8
                ? 'Sweet spot progression'
                : 'Threshold sharpening',
    sport: 'cycle',
    purpose:
      type === 'quality'
        ? 'Build sustainable power while keeping recoveries easy.'
        : 'Develop aerobic endurance with relaxed pedalling and steady fuelling.',
    minutes,
    tags: ['cycling', type, ...(light ? ['cutback'] : [])],
    steps: [
      effort('Spin up', 'cycle', duration(600), [zone('cycle', 'recovery')], 'warmup'),
      ...(type === 'quality'
        ? [
            repeat('Power intervals', sets, [
              effort('Controlled effort', 'cycle', duration(work), [
                zone(
                  'cycle',
                  light ? 'sweet_spot' : week < 4 ? 'tempo' : week < 8 ? 'sweet_spot' : 'threshold',
                ),
                numeric('rpe', light ? 6 : 7, 'rpe'),
              ]),
              effort('Easy spin', 'cycle', duration(180), [zone('cycle', 'recovery')], 'recovery'),
            ]),
            effort(
              'Endurance finish',
              'cycle',
              duration(minutes * 60 - 900 - sets * (work + 180)),
              [zone('cycle', 'endurance')],
              'main',
            ),
          ]
        : [
            effort(
              'Steady riding',
              'cycle',
              duration((minutes - 15) * 60),
              [
                zone('cycle', type === 'easy' ? 'recovery' : 'endurance'),
                numeric('cadence', 90, 'revolutions_per_minute'),
                instruction(
                  'Keep effort conversational; practise drinking and fuelling on longer rides.',
                ),
              ],
              'main',
            ),
          ]),
      effort('Spin down', 'cycle', duration(300), [zone('cycle', 'recovery')], 'cooldown'),
    ],
  };
}
function run(week: number, type: 'easy' | 'long'): Session {
  const minutes = minutesFor(type === 'long' ? 50 : 35, week);
  return {
    title: type === 'long' ? 'Long aerobic run' : 'Easy run and relaxed strides',
    sport: 'run',
    purpose: 'Build durable running volume without compromising the swim and bike sessions.',
    minutes,
    tags: ['triathlon', 'running', type],
    steps: [
      effort('Easy warm-up', 'run', duration(300), [zone('run', 'easy')], 'warmup'),
      effort(
        'Conversational running',
        'run',
        duration((minutes - (type === 'easy' ? 12 : 10)) * 60),
        [zone('run', 'easy')],
        'main',
      ),
      ...(type === 'easy'
        ? [
            repeat('Relaxed strides', 3, [
              effort('Smooth stride', 'run', duration(15), [numeric('rpe', 7, 'rpe')]),
              effort('Easy jog', 'run', duration(25), [], 'recovery'),
            ]),
          ]
        : []),
      effort('Easy cool-down', 'run', duration(300), [zone('run', 'easy')], 'cooldown'),
    ],
  };
}
function swim(week: number, technique: boolean): Session {
  const count = isLight(week) ? 5 : 8 + Math.floor(week / 4) * 2 + (week % 4);
  const metres = 600 + count * 100;
  return {
    title: technique ? 'Swim technique and aerobic repeats' : 'CSS swim progression',
    sport: 'swim',
    purpose: technique
      ? 'Improve body position and a relaxed catch.'
      : 'Develop repeatable swim pace with controlled rests.',
    minutes: Math.round((metres / 100) * 1.75 + count / 3 + 5),
    metres,
    tags: ['triathlon', 'swimming', technique ? 'technique' : 'css'],
    steps: [
      effort('Easy swim', 'swim', distance(200), [zone('swim', 'recovery')], 'warmup'),
      repeat('Drills', 4, [
        effort('Catch-up drill', 'swim', distance(50), [
          instruction('Stay long through the water and exhale steadily.'),
        ]),
        rest(15),
      ]),
      repeat('Main swim set', count, [
        effort('100 m repeat', 'swim', distance(100), [
          zone('swim', technique || isLight(week) ? 'endurance' : 'threshold'),
        ]),
        rest(20),
      ]),
      effort('Easy swim', 'swim', distance(200), [zone('swim', 'recovery')], 'cooldown'),
    ],
  };
}
function strength(week: number, focus: 'lower' | 'upper' | 'full', supporting = false): Session {
  const light = isLight(week);
  const sets = light ? 2 : week < 4 ? 3 : 4;
  const repetitions = light ? 8 : (week < 4 ? 8 : week < 8 ? 6 : 5) + (week % 4);
  const movements =
    focus === 'lower'
      ? ['Back squat', 'Romanian deadlift', 'Reverse lunge', 'Calf raise']
      : focus === 'upper'
        ? ['Dumbbell bench press', 'Bent-over row', 'Overhead press', 'Assisted pull-up']
        : ['Goblet squat', 'Dumbbell Romanian deadlift', 'Push-up', 'Cable row'];
  const minutes = light ? 30 : supporting ? 45 : 55 + (week % 4) * 3;
  return {
    title: `${focus === 'lower' ? 'Lower body' : focus === 'upper' ? 'Upper body' : 'Full body'} ${supporting ? 'supporting strength' : 'strength and accessories'}`,
    sport: 'strength',
    purpose: supporting
      ? 'Support endurance training with controlled lifting; finish fresh for the next ride or run.'
      : 'Progress squat, hinge, push and pull patterns; add load only when every set meets the effort target.',
    minutes,
    tags: ['strength', supporting ? 'supporting' : focus, ...(light ? ['deload'] : [])],
    steps: [
      effort(
        'Joint preparation and ramp-up sets',
        'other',
        duration(300),
        [instruction('Mobilise hips and shoulders, then use light rehearsal sets.')],
        'warmup',
      ),
      ...movements.map((movement) =>
        repeat(`${movement} sets`, supporting && week >= 8 ? 2 : sets, [
          {
            ...effort(movement, 'strength', reps(repetitions), [
              numeric('rir', light || supporting ? 3 : 2, 'repetitions'),
              ...(week < 4 ? [{ target_type: 'tempo', text_value: '3–1–1–0' }] : []),
            ]),
            movement,
            instructions:
              'Choose a load that leaves the prescribed repetitions in reserve. Increase slightly next week only if technique stays consistent.',
          },
          rest(supporting ? 75 : 120),
        ]),
      ),
      repeat('Carry and core', light ? 2 : 3, [
        {
          ...effort('Farmer carry', 'strength', distance(30), [numeric('rpe', 6, 'rpe')]),
          movement: 'Farmer carry',
        },
        {
          ...effort('Side plank', 'strength', duration(30), [
            instruction('Hold for 30 seconds on each side.'),
          ]),
          movement: 'Side plank',
        },
        rest(45),
      ]),
      effort('Easy mobility', 'other', duration(300), [], 'cooldown'),
    ],
  };
}
function brick(week: number): Session {
  const bikeMinutes = minutesFor(60, week);
  const runMinutes = minutesFor(15, week);
  return {
    title:
      week >= 8 && !isLight(week) ? 'Race-effort bike → run brick' : 'Aerobic bike → run brick',
    sport: 'mixed',
    purpose: 'Practise the transition and settle into a controlled run off the bike.',
    minutes: bikeMinutes + runMinutes + 5,
    tags: ['triathlon', 'brick', 'transition'],
    steps: [
      effort('Bike warm-up', 'cycle', duration(600), [zone('cycle', 'recovery')], 'warmup'),
      effort(
        'Bike main set',
        'cycle',
        duration((bikeMinutes - 10) * 60),
        [zone('cycle', week >= 8 && !isLight(week) ? 'tempo' : 'endurance')],
        'main',
      ),
      effort(
        'T2: bike to run',
        'other',
        duration(120),
        [instruction('Rack bike, change shoes and start the run smoothly.')],
        'transition',
      ),
      effort('Run off the bike', 'run', duration(runMinutes * 60), [zone('run', 'easy')], 'main'),
      effort('Walk and recover', 'other', duration(180), [], 'cooldown'),
    ],
  };
}
function conditioning(week: number, aerobic: boolean): Session {
  const light = isLight(week);
  const format = week % 3;
  const rounds = light ? 3 : 4 + Math.floor(week / 4) + (week % 4);
  const cap = light ? 10 : 15 + Math.floor(week / 4) * 3 + (week % 4) * 2;
  const mainMinutes = aerobic
    ? rounds * 5
    : format === 0
      ? rounds * 4
      : format === 1
        ? cap
        : cap + 5;
  const formatRules =
    format === 0
      ? `Start a station every minute; finish with time to rest. The fourth minute is rest. Complete ${rounds} four-minute rounds.`
      : format === 1
        ? `Repeat these stations for ${cap} minutes, resting as needed. Stop at the time cap; record rounds and reps separately.`
        : `Complete ${rounds} rounds with a ${cap + 5}-minute cap. Keep the first round controlled and stop at the cap even if unfinished.`;
  const stations: Step[] = [
    effort(
      'Row',
      'row',
      { completion_type: 'energy', numeric_value: light ? 8 : 12, unit: 'kilocalories' },
      [numeric('rpe', light || aerobic ? 5 : 7, 'rpe')],
    ),
    {
      ...effort('Kettlebell swing', 'strength', reps(light ? 10 : 15), [numeric('rpe', 6, 'rpe')]),
      movement: 'Kettlebell swing',
    },
    {
      ...effort('Box step-up', 'strength', reps(10), [
        instruction('Alternate legs; use a height that allows a controlled descent.'),
      ]),
      movement: 'Box step-up',
    },
  ];
  return {
    title: aerobic
      ? 'Aerobic circuit and mobility'
      : format === 0
        ? `EMOM ${rounds * 4} · erg and movement quality`
        : format === 1
          ? `AMRAP ${cap} · mixed gym circuit`
          : `${rounds} rounds for time · controlled conditioning`,
    sport: 'mixed',
    purpose: aerobic
      ? 'Build aerobic capacity between lifting days with low-impact stations.'
      : 'Develop repeatable high-intensity work while retaining sound movement technique.',
    // Ten timed minutes around the main set, plus a minute for the core exercise.
    minutes: mainMinutes + 11,
    tags: [
      'gym',
      aerobic ? 'aerobic' : 'hiit',
      aerobic ? 'circuit' : ['emom', 'amrap', 'for-time'][format]!,
    ],
    steps: [
      effort('Easy SkiErg warm-up', 'ski_erg', duration(300), [numeric('rpe', 3, 'rpe')], 'warmup'),
      ...(!aerobic
        ? [
            effort(
              'Format briefing',
              'other',
              { completion_type: 'open' },
              [instruction(formatRules)],
              'other',
            ),
          ]
        : []),
      aerobic
        ? repeat('Aerobic stations', rounds, [
            effort('Row steadily', 'row', duration(120), [numeric('rpe', 5, 'rpe')]),
            effort('SkiErg steadily', 'ski_erg', duration(120), [numeric('rpe', 5, 'rpe')]),
            rest(60),
          ])
        : format === 1
          ? {
              label: 'Repeat circuit until time cap',
              kind: 'sequence',
              steps: [...stations, rest(45)],
            }
          : repeat('Conditioning circuit', rounds, [...stations, rest(format === 0 ? 60 : 45)]),
      {
        ...effort('Dead bug', 'strength', reps(12), [numeric('rpe', 4, 'rpe')], 'other'),
        movement: 'Dead bug',
      },
      effort('Mobility and easy breathing', 'other', duration(300), [], 'cooldown'),
    ],
  };
}
const known = (value: number) => ({ status: 'known' as const, value });
const definitions: Record<
  ExampleKind,
  { name: string; description: string; goal: string; sports: SportBaseline[]; restDays: number[] }
> = {
  cycling: {
    name: 'Cycling endurance & strength · 12 weeks',
    description:
      'Three months of progressive cycling with supporting strength, cutback weeks and a final reduced-volume week.',
    goal: 'Build the endurance and sustainable power for a long sportive, supported by strength training.',
    sports: [
      {
        sport: 'cycle',
        currentSessions: known(4),
        desiredSessions: 4,
        weeklyDuration: known(14400),
        longestDuration: known(6300),
      },
      { sport: 'strength', currentSessions: known(2), desiredSessions: 2 },
    ],
    restDays: [4],
  },
  triathlon: {
    name: 'Triathlon foundation to race · 12 weeks',
    description:
      'Three months of swim, bike and run development with weekly bricks, supporting strength and a sprint-distance goal event.',
    goal: 'Prepare for a sprint triathlon with balanced swim, bike and run training and confident transitions.',
    sports: [
      {
        sport: 'run',
        currentSessions: known(3),
        desiredSessions: 3,
        weeklyDistance: known(18000),
        longestDistance: known(10000),
      },
      {
        sport: 'cycle',
        currentSessions: known(2),
        desiredSessions: 2,
        weeklyDuration: known(7200),
        longestDuration: known(3600),
      },
      {
        sport: 'swim',
        currentSessions: known(2),
        desiredSessions: 2,
        weeklyDistance: known(2800),
        longestDistance: known(1400),
      },
      { sport: 'strength', currentSessions: known(1), desiredSessions: 1 },
    ],
    restDays: [4],
  },
  'strength-hiit': {
    name: 'Strength & HIIT athlete · 12 weeks',
    description:
      'Three months of gym training: lower, upper and full-body lifting, ergs, carries, core, EMOM, AMRAP and controlled rounds for time.',
    goal: 'Build full-body strength and repeatable conditioning across a broad range of gym workouts.',
    sports: [{ sport: 'strength', currentSessions: known(3), desiredSessions: 3 }],
    restDays: [3, 6],
  },
};
function weeklyTargets(sessions: { day: number; session: Session }[]): WeekTarget[] {
  const targets: WeekTarget[] = [];
  for (const sport of ['run', 'cycle', 'swim', 'mixed', 'strength'] as const) {
    const matching = sessions.filter(({ session }) => session.sport === sport);
    if (!matching.length) continue;
    targets.push({
      metric: 'duration',
      discipline: sport,
      target: matching.reduce((sum, { session }) => sum + session.minutes * 60, 0),
      unit: 'seconds',
    });
    const metres = matching.reduce((sum, { session }) => sum + (session.metres ?? 0), 0);
    if (metres)
      targets.push({ metric: 'distance', discipline: sport, target: metres, unit: 'metres' });
    if (sport === 'strength')
      targets.push({
        metric: 'strength_session_count',
        discipline: sport,
        target: matching.length,
        unit: 'sessions',
      });
  }
  return targets;
}
export function buildExample(kind: ExampleKind, anchor: string) {
  const definition = definitions[kind];
  const phases: { phase: BlockPhase; weeks: number; title: string; description: string }[] = [
    {
      phase: 'base',
      weeks: 4,
      title: kind === 'strength-hiit' ? 'Movement foundation' : 'Aerobic foundation',
      description:
        'Three progressive weeks establish technique and consistency; week four reduces volume to absorb the work.',
    },
    {
      phase: 'build',
      weeks: 4,
      title:
        kind === 'strength-hiit' ? 'Strength and work capacity' : 'Sustainable power and endurance',
      description:
        'Progress the main work for three weeks, then take a cutback week while retaining familiar movements.',
    },
    {
      phase: 'peak',
      weeks: 3,
      title:
        kind === 'strength-hiit'
          ? 'Strength and conditioning integration'
          : 'Event-specific preparation',
      description:
        'Consolidate the largest training weeks with specific efforts and controlled intensity.',
    },
    {
      phase: kind === 'strength-hiit' ? 'recovery' : 'taper',
      weeks: 1,
      title: kind === 'strength-hiit' ? 'Deload and consolidate' : 'Freshen and finish',
      description: 'Reduce volume, keep technique sharp and finish the training cycle fresh.',
    },
  ];
  let firstWeek = 0;
  const blocks = phases.map(({ weeks, ...block }) => {
    const start = firstWeek;
    firstWeek += weeks;
    return {
      ...block,
      firstWeek: start,
      weekCount: weeks,
      startDate: shiftDay(anchor, start * 7),
      endDate: shiftDay(anchor, firstWeek * 7 - 1),
    };
  });
  const weeks = Array.from({ length: 12 }, (_, index) => {
    let sessions: { day: number; session: Session }[];
    if (kind === 'cycling')
      sessions = [
        { day: 0, session: strength(index, 'full', true) },
        { day: 1, session: ride(index, 'quality') },
        { day: 2, session: ride(index, 'easy') },
        ...(index < 8 ? [{ day: 3, session: strength(index, 'lower', true) }] : []),
        { day: 5, session: ride(index, 'long') },
        { day: 6, session: ride(index, 'easy') },
      ];
    else if (kind === 'triathlon')
      sessions = [
        { day: 0, session: swim(index, true) },
        { day: 0, session: strength(index, 'full', true) },
        { day: 1, session: ride(index, 'quality') },
        { day: 2, session: run(index, 'easy') },
        { day: 3, session: swim(index, false) },
        { day: 5, session: brick(index) },
        { day: 6, session: run(index, 'long') },
      ];
    else
      sessions = [
        { day: 0, session: strength(index, 'lower') },
        { day: 1, session: conditioning(index, false) },
        { day: 2, session: strength(index, 'upper') },
        { day: 4, session: strength(index, 'full') },
        { day: 5, session: conditioning(index, true) },
      ];
    if (kind === 'triathlon' && index === 11)
      sessions = sessions
        .filter(({ day }) => day < 5)
        .concat([
          {
            day: 6,
            session: {
              title: 'Sprint triathlon goal event',
              sport: 'mixed',
              purpose:
                'Put twelve weeks of preparation into practice: a controlled swim, steady bike and confident run.',
              minutes: 100,
              tags: ['triathlon', 'race'],
              race: 'A',
              steps: [
                effort('Swim 750 m', 'swim', distance(750), [zone('swim', 'endurance')]),
                effort(
                  'T1',
                  'other',
                  duration(180),
                  [instruction('Change equipment and prepare to ride.')],
                  'transition',
                ),
                effort('Bike 20 km', 'cycle', distance(20000), [zone('cycle', 'tempo')]),
                effort(
                  'T2',
                  'other',
                  duration(120),
                  [instruction('Rack bike and change shoes.')],
                  'transition',
                ),
                effort('Run 5 km', 'run', distance(5000), [zone('run', 'easy')]),
              ],
            },
          },
        ]);
    const blockIndex = blocks.findIndex(
      (b) => index >= b.firstWeek && index < b.firstWeek + b.weekCount,
    );
    return {
      index,
      blockIndex,
      position: index - blocks[blockIndex]!.firstWeek + 1,
      cutback: index === 3 || index === 7,
      title: `Week ${index + 1} · ${blocks[blockIndex]!.title}`,
      description:
        kind === 'strength-hiit'
          ? 'Thursday and Sunday are rest days. Alternate lifting and conditioning; scale loads to the prescribed effort.'
          : 'Friday is a rest day. Keep easy sessions easy and reduce volume during cutback weeks.',
      startDate: shiftDay(anchor, index * 7),
      endDate: shiftDay(anchor, index * 7 + 6),
      sessions,
      targets: weeklyTargets(sessions),
    };
  });
  const brief: Brief = {
    ...emptyBrief(),
    goal: definition.goal,
    sports: definition.sports,
    weekdays: Array.from({ length: 7 }, (_, day) =>
      definition.restDays.includes(day) ? 'unavailable' : 'available',
    ),
    context:
      'Synthetic example for exploring the application. Adjust training and loads to your experience. Existing fitness is preserved; missing endurance calibration is labelled as an example estimate. Bricks count toward both bike and run frequency. Conditioning complements the three lifting days in the gym plan.',
  };
  return {
    kind,
    name: definition.name,
    description: definition.description,
    anchor,
    endDate: shiftDay(anchor, 83),
    blocks,
    weeks,
    brief,
  };
}
export type ExampleBlueprint = ReturnType<typeof buildExample>;

/** Independent identities let unchanged examples survive edits to another blueprint. */
export const BLUEPRINT_REVISIONS = Object.fromEntries(
  EXAMPLE_KINDS.map((kind) => [
    kind,
    `${kind}-example-v1-${createHash('sha256')
      .update(JSON.stringify(buildExample(kind, '2000-01-03')))
      .digest('hex')
      .slice(0, 12)}`,
  ]),
) as Record<ExampleKind, string>;

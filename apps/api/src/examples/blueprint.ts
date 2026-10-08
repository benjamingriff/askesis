import { createHash } from 'node:crypto';
import type { Insertable } from 'kysely';
import type { DB } from '../database/generated.js';
import { localDate } from '../modules/athletes/timezone.js';
import { emptyBrief, type Brief } from '../modules/plans/brief.schemas.js';
import type { StepDiscipline, WorkoutDiscipline } from '../modules/plans/disciplines.js';
import type { BlockPhase, RacePriority } from '../modules/plans/periodization.js';

export const EXAMPLE_NAME = 'Multisport example · 8 weeks';
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
const range = (
  target_type: string,
  min: number,
  value: number,
  max: number,
  unit: string,
): Target => ({ target_type, minimum_value: min, target_value: value, maximum_value: max, unit });
const text = (target_type: 'instruction' | 'tempo', text_value: string): Target => ({
  target_type,
  text_value,
});
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
const rest = (seconds = 60) =>
  effort('Recover and reset', 'other', duration(seconds), [], 'recovery');
const repeat = (label: string, count: number, steps: Step[]): Step => ({
  label,
  kind: 'repeat',
  repeat: count,
  steps,
});
const sequence = (label: string, steps: Step[]): Step => ({ label, kind: 'sequence', steps });

const running = (week: number): Session => {
  const titles = [
    'Easy run and strides',
    'Hill repetitions',
    'Threshold cruise intervals',
    'Long aerobic run',
    'Recovery run',
    '5K controlled test',
    'Progression run',
    'Easy run and event strides',
  ];
  const recovery = week === 4 || week === 7;
  const main =
    week === 1
      ? repeat('Hill set', 6, [
          effort('Run uphill', 'run', duration(60), [
            zone('run', 'interval'),
            numeric('rpe', 8, 'rpe'),
          ]),
          effort('Jog back', 'run', duration(120), [zone('run', 'easy')], 'recovery'),
        ])
      : week === 2
        ? repeat('Cruise set', 3, [
            effort('Threshold', 'run', distance(1600), [zone('run', 'threshold')]),
            effort('Easy jog', 'run', duration(120), [zone('run', 'easy')], 'recovery'),
          ])
        : effort(
            titles[week]!,
            'run',
            week === 5 ? distance(5000) : duration((recovery ? 25 : week === 3 ? 70 : 35) * 60),
            [zone('run', week === 5 ? 'threshold' : 'easy')],
            'main',
          );
  return {
    title: titles[week]!,
    sport: 'run',
    purpose: 'Demonstrate running volume, effort changes and repeat prescriptions.',
    minutes: week === 3 ? 90 : 50,
    metres: week === 3 ? 15000 : 8000,
    tags: ['running', recovery ? 'recovery' : 'quality'],
    steps: [
      effort('Easy warm-up', 'run', duration(600), [zone('run', 'easy')], 'warmup'),
      main,
      repeat('Relaxed strides', 4, [
        effort('Stride', 'run', duration(20), [zone('run', 'repetition')]),
        effort('Walk/jog', 'run', duration(40), [], 'recovery'),
      ]),
      effort('Easy cool-down', 'run', duration(300), [zone('run', 'easy')], 'cooldown'),
    ],
  };
};

const cycling = (week: number): Session => ({
  title:
    week === 5
      ? '20-minute FTP test rehearsal'
      : week === 4
        ? 'Recovery spin'
        : week % 2
          ? 'Endurance ride and cadence'
          : 'Sweet spot 2 × 15',
  sport: 'cycle',
  purpose: 'FTP-based riding with RPE and cadence guidance.',
  minutes: week === 5 ? 50 : week === 4 || week === 7 ? 45 : 65,
  tags: ['cycling', 'ftp'],
  steps: [
    effort('Spin up', 'cycle', duration(600), [zone('cycle', 'recovery')], 'warmup'),
    repeat('Main riding set', week === 4 || week === 5 || week === 7 ? 1 : 2, [
      effort(
        week === 5 ? '20-minute test effort' : 'Controlled riding',
        'cycle',
        duration(week === 5 ? 1200 : 900),
        [
          zone(
            'cycle',
            week === 5
              ? 'threshold'
              : week === 4
                ? 'recovery'
                : week % 2
                  ? 'endurance'
                  : 'sweet_spot',
          ),
          numeric('rpe', week === 5 ? 9 : week === 4 ? 2 : 6, 'rpe'),
          range('cadence', 80, 90, 100, 'revolutions_per_minute'),
        ],
      ),
      effort('Easy spin', 'cycle', duration(300), [zone('cycle', 'recovery')], 'recovery'),
    ]),
    effort('Power target illustration', 'cycle', duration(300), [
      range('power', 140, 160, 180, 'watts'),
      text('instruction', 'Example watt range; use your current calibrated zones for training.'),
    ]),
    effort('Spin down', 'cycle', duration(600), [zone('cycle', 'recovery')], 'cooldown'),
  ],
});

const swimming = (week: number): Session => ({
  title:
    week % 3 === 0
      ? 'CSS swim intervals'
      : week % 3 === 1
        ? 'Swim technique and endurance'
        : '400/200 swim test rehearsal',
  sport: 'swim',
  purpose: 'Pool work with CSS zones, distance repeats and technique instructions.',
  minutes: 45,
  metres: week % 3 === 2 ? 1600 : 1800,
  tags: ['swimming', 'pool', 'css'],
  steps: [
    effort('Easy swim', 'swim', distance(300), [zone('swim', 'recovery')], 'warmup'),
    repeat('Technique set', 4, [
      effort('Catch-up drill', 'swim', distance(50), [
        zone('swim', 'endurance'),
        text('instruction', 'Long body line; breathe to both sides.'),
      ]),
      rest(15),
    ]),
    week % 3 === 2
      ? sequence('400/200 CSS test rehearsal', [
          effort('400 m controlled test', 'swim', distance(400), [
            zone('swim', 'speed'),
            numeric('rpe', 9, 'rpe'),
          ]),
          rest(300),
          effort('200 m controlled test', 'swim', distance(200), [
            zone('swim', 'speed'),
            numeric('rpe', 9, 'rpe'),
          ]),
        ])
      : repeat('Main swim set', 8, [
          effort('100 m at CSS', 'swim', distance(100), [zone('swim', 'threshold')]),
          rest(20),
        ]),
    effort('Pace illustration', 'swim', distance(200), [
      range('pace', 100, 105, 110, 'seconds_per_100_metres'),
    ]),
    effort('Easy swim', 'swim', distance(300), [zone('swim', 'recovery')], 'cooldown'),
  ],
});

const strength = (week: number): Session => ({
  title: week % 2 ? 'Full body, carries and core' : 'Full body supporting strength',
  sport: 'strength',
  purpose: 'Strength prescriptions with movements, repetitions, RIR, loads and tempo.',
  minutes: 50,
  tags: ['strength', 'supporting'],
  steps: [
    effort(
      'Joint preparation',
      'other',
      { completion_type: 'open' },
      [text('instruction', 'Mobilise ankles, hips and shoulders for five minutes.')],
      'warmup',
    ),
    ...[
      'Back squat',
      'Romanian deadlift',
      'Dumbbell bench press',
      'Bent-over row',
      'Split squat',
    ].map((movement, index) =>
      repeat(`${movement} sets`, week === 4 || week === 7 ? 2 : 3, [
        {
          ...effort(movement, 'strength', reps(8), [
            numeric('rir', 2, 'repetitions'),
            range('load', 20, 30 + index * 5, 60, 'kilograms'),
          ]),
          movement,
          instructions:
            'Suggested example weight. Adjust to finish with two repetitions in reserve.',
        },
        rest(90),
      ]),
    ),
    effort('Tempo goblet squat', 'strength', reps(10), [
      text('tempo', '3–1–1–0'),
      numeric('percentage_1rm', 60, 'percent'),
    ]),
    effort('Farmer carry', 'strength', distance(40), [
      numeric('load', 24, 'kilograms'),
      text('instruction', 'Suggested load per hand; brace and walk steadily.'),
    ]),
    effort('Core hold', 'strength', duration(45), [numeric('rpe', 6, 'rpe')], 'other'),
    effort(
      'Stretch',
      'other',
      {
        completion_type: 'until_condition',
        condition_type: 'comfortable_range',
        condition_value: 'Move freely without discomfort',
        unit: null,
      },
      [text('instruction', 'End when you can move comfortably; condition-based storage example.')],
      'cooldown',
    ),
  ],
});

const brick = (week: number): Session => ({
  title: week === 7 ? 'Swim, bike, run event rehearsal' : 'Bike → run brick',
  sport: 'mixed',
  purpose: 'Change disciplines within one prescription and practise transitions.',
  minutes: week === 7 ? 100 : 85,
  tags: ['triathlon', 'brick', 'transition'],
  steps: [
    ...(week === 7
      ? [
          effort('Open-water swim rehearsal', 'swim', distance(750), [zone('swim', 'endurance')]),
          effort(
            'T1',
            'other',
            duration(180),
            [text('instruction', 'Exit the water, change equipment and prepare to ride.')],
            'transition',
          ),
        ]
      : []),
    effort('Easy bike warm-up', 'cycle', duration(600), [zone('cycle', 'recovery')], 'warmup'),
    sequence('Bike main set', [
      effort('Endurance ride', 'cycle', duration(2400), [
        zone('cycle', 'endurance'),
        numeric('rpe', 5, 'rpe'),
      ]),
    ]),
    effort(
      'T2: bike to run',
      'other',
      duration(120),
      [text('instruction', 'Rack bike, change shoes, settle breathing.')],
      'transition',
    ),
    effort('Run off the bike', 'run', duration(1500), [zone('run', 'easy')], 'main'),
    effort('Walk and recover', 'other', duration(480), [], 'cooldown'),
  ],
});

const hyrox = (): Session => {
  const stations: Step[] = [
    effort('SkiErg', 'ski_erg', distance(1000), [numeric('rpe', 7, 'rpe')]),
    effort('Sled push', 'strength', distance(50), [
      numeric('rpe', 8, 'rpe'),
      numeric('load', 100, 'kilograms'),
    ]),
    effort('Sled pull', 'strength', distance(50), [
      numeric('rpe', 8, 'rpe'),
      numeric('load', 75, 'kilograms'),
    ]),
    effort('Burpee broad jumps', 'strength', distance(80), [numeric('rpe', 7, 'rpe')]),
    effort('Row', 'row', distance(1000), [numeric('rpe', 7, 'rpe')]),
    effort('Farmer carry', 'strength', distance(200), [
      numeric('load', 24, 'kilograms'),
      text('instruction', 'Suggested load per hand.'),
    ]),
    effort('Sandbag lunges', 'strength', distance(100), [numeric('load', 20, 'kilograms')]),
    effort('Wall balls', 'strength', reps(100), [numeric('load', 6, 'kilograms')]),
  ];
  return {
    title: 'Hyrox stations and compromised running',
    sport: 'mixed',
    purpose: 'A complete station vocabulary with running between each effort.',
    minutes: 90,
    tags: ['hyrox', 'stations', 'compromised-running'],
    steps: [
      effort('Warm-up jog', 'run', duration(600), [zone('run', 'easy')], 'warmup'),
      ...stations.map((station) =>
        sequence(`Run + ${station.label}`, [
          effort('Compromised run', 'run', distance(500), [
            zone('run', 'easy'),
            numeric('rpe', 6, 'rpe'),
          ]),
          station,
          rest(60),
        ]),
      ),
      effort('Cool-down walk', 'other', duration(300), [], 'cooldown'),
    ],
  };
};

const conditioning = (week: number): Session => {
  const names = [
    'EMOM 12 · gym conditioning',
    'AMRAP 15 · mixed circuit',
    '4 rounds for time',
    'Timed aerobic circuit',
  ];
  const movements = [
    effort(
      'Row for calories',
      'row',
      { completion_type: 'energy', numeric_value: 12, unit: 'kilocalories' },
      [numeric('rpe', 6, 'rpe')],
    ),
    effort('Push-ups', 'strength', reps(10), [numeric('rir', 2, 'repetitions')]),
    effort('SkiErg', 'ski_erg', duration(45), [numeric('rpe', 6, 'rpe')]),
  ];
  return {
    title: names[week % 4]!,
    sport: 'mixed',
    purpose:
      'Gym format examples expressed as steps and instructions; no automatic scoring or AMRAP execution.',
    minutes: 30,
    tags: ['gym', ['emom', 'amrap', 'for-time', 'circuit'][week % 4]!],
    steps: [
      {
        ...effort(
          'Format briefing',
          'other',
          { completion_type: 'open' },
          [
            text(
              'instruction',
              week % 4 === 0
                ? 'Start one station each minute for 12 minutes; rest for the remaining seconds.'
                : week % 4 === 1
                  ? 'Repeat the circuit for 15 minutes; record rounds separately. The time cap is an instruction.'
                  : 'Complete four controlled rounds; prioritise movement quality.',
            ),
          ],
          'other',
        ),
        instructions:
          'These formats use existing containers and instructions rather than a dedicated score/time-cap model.',
      },
      repeat('Circuit rounds', week % 4 === 0 ? 4 : week % 4 === 1 ? 1 : 4, [
        sequence('Stations', movements),
        rest(30),
      ]),
      effort(
        'Finish on lap',
        'other',
        { completion_type: 'until_lap' },
        [text('instruction', 'Lap-ended storage example: finish this step manually.')],
        'transition',
      ),
      effort('Treadmill storage examples', 'run', duration(120), [
        numeric('speed', 10, 'kilometres_per_hour'),
        range('heart_rate', 120, 130, 140, 'beats_per_minute'),
        numeric('cadence', 170, 'steps_per_minute'),
      ]),
      effort('Pace range example', 'run', distance(400), [
        range('pace', 330, 345, 360, 'seconds_per_kilometre'),
      ]),
      effort('Walk and stretch', 'other', duration(180), [], 'cooldown'),
    ],
  };
};

const known = (value: number) => ({ status: 'known' as const, value });
export const exampleBrief = (): Brief => ({
  ...emptyBrief(),
  goal: 'Inspect a complete multisport example: endurance, triathlon transitions, supporting strength, Hyrox and gym conditioning.',
  sports: [
    {
      sport: 'run',
      currentSessions: known(3),
      desiredSessions: 3,
      weeklyDistance: known(25000),
      longestDistance: known(15000),
    },
    {
      sport: 'cycle',
      currentSessions: known(2),
      desiredSessions: 2,
      weeklyDuration: known(9000),
      longestDuration: known(5400),
    },
    {
      sport: 'swim',
      currentSessions: known(2),
      desiredSessions: 2,
      weeklyDistance: known(3600),
      longestDistance: known(1800),
    },
    { sport: 'strength', currentSessions: known(2), desiredSessions: 2 },
  ],
  weekdays: [
    'preferred',
    'available',
    'available',
    'available',
    'unavailable',
    'preferred',
    'available',
  ],
  context:
    'Software showcase, not an individual coaching recommendation. Friday is a rest day. Up to two sessions per day. Some prescriptions demonstrate storage fields beyond the coaching writer. Existing athlete fitness is preserved; any missing calibration is explicitly marked as an example estimate.',
});

/**
 * Every phase appears, and build repeats, so clients show Build 1 and Build 2. Base ends with a
 * cutback week; a B race closes Build 1 and recovery follows it; Build 2 holds a C race and the
 * taper leads to the A race on the last day. Cutback, recovery and taper weeks carry reduced
 * weekly targets.
 */
const PHASE_PLAN: { phase: BlockPhase; weeks: number; title: string; description: string }[] = [
  {
    phase: 'base',
    weeks: 3,
    title: 'Aerobic foundation',
    description:
      'Mostly easy volume across every sport, with technique and supporting strength. The third week is a cutback.',
  },
  {
    phase: 'build',
    weeks: 1,
    title: 'Threshold build',
    description: 'Longer threshold efforts in each sport, closing with a B-race tune-up.',
  },
  {
    phase: 'recovery',
    weeks: 1,
    title: 'Absorb the tune-up',
    description: 'An easy week after the B race so the first build is absorbed.',
  },
  {
    phase: 'build',
    weeks: 1,
    title: 'Race-specific build',
    description: 'Bricks, transitions and Hyrox stations at event intensity, with a C race.',
  },
  {
    phase: 'peak',
    weeks: 1,
    title: 'Sharpen',
    description: 'The most event-like week: full rehearsals at target effort.',
  },
  {
    phase: 'taper',
    weeks: 1,
    title: 'Taper to the event',
    description: 'Volume comes down and intensity stays, arriving fresh for the A race.',
  },
];
const CUTBACK_WEEKS = new Set([2]);
const LIGHT_WEEK_FACTOR = 0.75;

/** A lighter session for a light week: the same structure with shorter efforts and estimates. */
function lighten(session: Session, factor: number): Session {
  const scale = (step: Step): Step => {
    const completion = step.completion;
    const unit =
      completion?.completion_type === 'duration'
        ? 30
        : completion?.completion_type === 'distance'
          ? 50
          : null;
    return {
      ...step,
      ...(completion && unit
        ? {
            completion: {
              ...completion,
              numeric_value: Math.max(
                unit,
                Math.round((Number(completion.numeric_value) * factor) / unit) * unit,
              ),
            },
          }
        : {}),
      ...(step.steps ? { steps: step.steps.map(scale) } : {}),
    };
  };
  return {
    ...session,
    minutes: Math.round(session.minutes * factor),
    ...(session.metres ? { metres: Math.round((session.metres * factor) / 100) * 100 } : {}),
    steps: session.steps.map(scale),
  };
}

/** Races by week index and weekday, replacing that day's session. */
const RACES: Record<number, { day: number; race: (session: Session) => Session }> = {
  3: {
    day: 5,
    race: (session) => ({
      ...session,
      title: 'Sprint duathlon tune-up',
      purpose: 'B race: an important tune-up at event effort, with easier days before it.',
      tags: [...session.tags, 'race'],
      race: 'B',
    }),
  },
  5: {
    day: 2,
    race: (session) => ({
      ...session,
      title: '5K club race',
      purpose: 'C race: raced hard as training, without a taper.',
      tags: [...session.tags, 'race'],
      race: 'C',
    }),
  },
  7: {
    day: 6,
    race: (session) => ({
      ...session,
      title: 'Hyrox event',
      purpose: 'A race: the goal event, reached through the taper.',
      tags: [...session.tags, 'race'],
      race: 'A',
    }),
  },
};

export function buildExample(anchor: string) {
  const endDate = shiftDay(anchor, 55);
  let firstWeek = 0;
  const blocks = PHASE_PLAN.map(({ weeks, ...block }) => {
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
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const blockIndex = blocks.findIndex(
      (b) => index >= b.firstWeek && index < b.firstWeek + b.weekCount,
    );
    const block = blocks[blockIndex]!;
    const volume =
      CUTBACK_WEEKS.has(index) || block.phase === 'recovery' || block.phase === 'taper'
        ? LIGHT_WEEK_FACTOR
        : 1;
    return {
      index,
      blockIndex,
      position: index - block.firstWeek + 1,
      cutback: CUTBACK_WEEKS.has(index),
      volume,
      title: `Week ${index + 1} · ${block.title}`,
      startDate: shiftDay(anchor, index * 7),
      endDate: shiftDay(anchor, index * 7 + 6),
      sessions: [
        { day: 0, session: swimming(index) },
        { day: 0, session: strength(index) },
        { day: 1, session: cycling(index) },
        { day: 2, session: running(index) },
        { day: 3, session: conditioning(index) },
        { day: 5, session: brick(index) },
        { day: 6, session: hyrox() },
        // After the A race, the plan's last session is an easy technique swim, not a test.
        { day: 6, session: swimming(index === 7 ? 7 : index + 1) },
      ].map(({ day, session }, position, all) => ({
        day,
        // The first session on the race day becomes the race. Other sessions in cutback,
        // recovery and taper weeks shrink, so their published totals match the lighter targets.
        session:
          RACES[index]?.day === day && all.findIndex((s) => s.day === day) === position
            ? RACES[index].race(session)
            : volume < 1
              ? lighten(session, volume)
              : session,
      })),
    };
  });
  return { anchor, endDate, blocks, weeks, brief: exampleBrief() };
}

/**
 * Publication identity. The fingerprint changes whenever the blueprint's content does, so a
 * deploy with edited example data publishes a new edition and archives the untouched old one.
 * Bump the prefix for changes outside the blueprint, such as the writer or publication steps.
 */
export const BLUEPRINT_REVISION = `multisport-showcase-v3-${createHash('sha256')
  .update(JSON.stringify(buildExample('2000-01-03')))
  .digest('hex')
  .slice(0, 12)}`;

/** Exhaustive storage vocabulary: additions require a deliberate fixture decision. */
export const exampleCoverage = {
  completionTypes: [
    'duration',
    'distance',
    'repetitions',
    'energy',
    'until_lap',
    'until_condition',
    'open',
  ],
  targetTypes: [
    'zone',
    'pace',
    'speed',
    'heart_rate',
    'power',
    'cadence',
    'rpe',
    'load',
    'percentage_1rm',
    'rir',
    'tempo',
    'instruction',
  ],
  stepRoles: ['warmup', 'work', 'recovery', 'cooldown', 'transition', 'main', 'other'],
  racePriorities: ['A', 'B', 'C'],
  weekMetrics: [
    'distance',
    'duration',
    'hard_session_count',
    'strength_session_count',
    'training_load',
  ],
} as const;

import type { EffortStep, RepeatStep, Step, Workout, Zone } from './types';

const min = (m: number) => m * 60;

const effort = (
  role: EffortStep['role'],
  label: string,
  zone: Zone | undefined,
  amount: { seconds?: number; meters?: number; detail?: string },
): EffortStep => ({ type: 'effort', role, label, zone, ...amount });

const repeat = (count: number, steps: Step[]): RepeatStep => ({ type: 'repeat', count, steps });

export const workoutId = (date: string) => `wo-${date}`;

type Base = Pick<Workout, 'date'> & Partial<Pick<Workout, 'change' | 'changeNote' | 'coachNote'>>;

export function easyRun(base: Base, km: number, title = 'Easy run'): Workout {
  return {
    id: workoutId(base.date),
    kind: 'easy',
    title,
    blurb: 'Keep it conversational. This run is about time on feet, not pace.',
    steps: [effort('main', 'Easy run', 'easy', { meters: km * 1000 })],
    coachNote:
      'Let the pace come to you. If you can’t chat in full sentences, ease off — the adaptation happens on the easy days.',
    ...base,
  };
}

export function recoveryRun(base: Base, km: number): Workout {
  return {
    id: workoutId(base.date),
    kind: 'recovery',
    title: 'Recovery run',
    blurb: 'Short and gentle to loosen up after the weekend.',
    steps: [effort('main', 'Recovery jog', 'recovery', { meters: km * 1000 })],
    coachNote: 'Slower than you think. Walk any hills if your legs feel heavy.',
    ...base,
  };
}

export function stridesRun(base: Base, km: number): Workout {
  return {
    id: workoutId(base.date),
    kind: 'easy',
    title: 'Easy run + strides',
    blurb: 'Easy running with four relaxed strides to keep the legs sharp.',
    steps: [
      effort('main', 'Easy run', 'easy', { meters: (km - 0.6) * 1000 }),
      repeat(4, [
        effort('work', 'Stride', 'interval', { seconds: 20 }),
        effort('recovery', 'Walk back', 'recovery', { seconds: 60 }),
      ]),
    ],
    coachNote: 'Strides are fast but relaxed — think smooth, not straining.',
    ...base,
  };
}

export function longRun(base: Base, km: number, finish?: { km: number; zone: Zone }): Workout {
  const steps: Step[] = finish
    ? [
        effort('main', 'Easy running', 'easy', { meters: (km - finish.km) * 1000 }),
        effort(
          'work',
          finish.zone === 'tempo' ? 'Half-marathon pace' : 'Steady finish',
          finish.zone,
          {
            meters: finish.km * 1000,
          },
        ),
      ]
    : [effort('main', 'Long easy run', 'easy', { meters: km * 1000 })];
  return {
    id: workoutId(base.date),
    kind: 'long',
    title: finish ? 'Long run with a fast finish' : 'Long run',
    blurb: finish
      ? `Build into it, then close the last ${finish.km} km at ${finish.zone === 'tempo' ? 'goal pace' : 'a steady effort'}.`
      : 'The week’s backbone. Fuel early and keep the first half patient.',
    steps,
    coachNote: finish
      ? 'Practise your race-day fuelling here. The finish should feel controlled, never desperate.'
      : 'Take a gel or chews every 40 minutes from the start, and drink little and often.',
    ...base,
  };
}

export function tempoRun(base: Base, minutes: number, split = false): Workout {
  const work: Step[] = split
    ? [
        repeat(2, [
          effort('work', 'Tempo', 'tempo', { seconds: min(minutes / 2) }),
          effort('recovery', 'Easy jog', 'recovery', { seconds: 120 }),
        ]),
      ]
    : [effort('work', 'Tempo', 'tempo', { seconds: min(minutes) })];
  return {
    id: workoutId(base.date),
    kind: 'tempo',
    title: split ? `2 × ${minutes / 2} min tempo` : `${minutes} min tempo`,
    blurb: 'Comfortably hard running to raise the pace you can hold for a long time.',
    steps: [
      effort('warmup', 'Warm-up', 'easy', { seconds: min(12) }),
      ...work,
      effort('cooldown', 'Cool-down', 'easy', { seconds: min(10) }),
    ],
    coachNote:
      'Start the first kilometre a touch slower than target. You should finish wanting a little more, not less.',
    ...base,
  };
}

export function intervalRun(
  base: Base,
  reps: number,
  meters: number,
  recoverySeconds = 90,
): Workout {
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  return {
    id: workoutId(base.date),
    kind: 'intervals',
    title: `${reps} × ${label}`,
    blurb: 'Fast repeats with jog recoveries to build speed and running economy.',
    steps: [
      effort('warmup', 'Warm-up', 'easy', { seconds: min(12) }),
      repeat(reps, [
        effort('work', `${label} fast`, 'interval', { meters }),
        effort('recovery', 'Easy jog', 'recovery', { seconds: recoverySeconds }),
      ]),
      effort('cooldown', 'Cool-down', 'easy', { seconds: min(10) }),
    ],
    coachNote:
      'Aim for even splits across every rep. If the last one is quicker than the first, you paced it well.',
    ...base,
  };
}

export function strengthSession(base: Base, focus: 'lower' | 'full' = 'lower'): Workout {
  const lower: EffortStep[] = [
    effort('main', 'Goblet squat', undefined, { seconds: min(6), detail: '3 × 10 · RIR 2' }),
    effort('main', 'Single-leg Romanian deadlift', undefined, {
      seconds: min(7),
      detail: '3 × 8 each · RIR 2',
    }),
    effort('main', 'Walking lunge', undefined, { seconds: min(5), detail: '2 × 12 each' }),
    effort('main', 'Calf raise (straight leg)', undefined, {
      seconds: min(4),
      detail: '3 × 15 · slow tempo',
    }),
    effort('main', 'Side plank', undefined, { seconds: min(4), detail: '3 × 40 sec each' }),
  ];
  const full: EffortStep[] = [
    ...lower.slice(0, 3),
    effort('main', 'Push-up', undefined, { seconds: min(4), detail: '3 × 10' }),
    effort('main', 'Dead bug', undefined, { seconds: min(4), detail: '3 × 8 each' }),
  ];
  return {
    id: workoutId(base.date),
    kind: 'strength',
    title: 'Strength & stability',
    blurb: 'Keeps hips, calves and core robust for the heavier weeks ahead.',
    steps: focus === 'lower' ? lower : full,
    coachNote:
      'Leave two reps in the tank. This should make you stronger without making Thursday’s run harder.',
    ...base,
  };
}

export function raceWorkout(
  base: Base,
  name: string,
  km: number,
  zone: Zone,
  effortLabel: string,
): Workout {
  const warm = km >= 15 ? 10 : 15;
  return {
    id: workoutId(base.date),
    kind: 'race',
    title: name,
    blurb: effortLabel,
    steps: [
      effort('warmup', 'Warm-up', 'easy', { seconds: min(warm) }),
      effort('main', 'Race', zone, { meters: km * 1000 }),
      ...(km >= 15 ? [] : [effort('cooldown', 'Cool-down', 'easy', { seconds: min(10) })]),
    ],
    coachNote:
      km >= 15
        ? 'Go out at goal pace or a touch slower. The first 5 km should feel almost too easy.'
        : 'Treat this as a dress rehearsal: practise your fuelling, kit and warm-up routine.',
    ...base,
  };
}

export function restDay(base: Base): Workout {
  return {
    id: workoutId(base.date),
    kind: 'rest',
    title: 'Rest day',
    blurb: 'Recovery is where the fitness is built.',
    steps: [],
    coachNote: 'Easy walking, mobility work and good sleep. Nothing more.',
    ...base,
  };
}

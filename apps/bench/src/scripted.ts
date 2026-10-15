/** Offline integration fixture. This verifies the harness, never real coaching quality. */
import type { ScriptedTurn } from '@askesis/agent/testing';
import type { Scenario } from './scenario.js';
import { addDays } from './scenario.js';
import type { BenchmarkSnapshot } from '@askesis/api/benchmark';
import type { Review } from './models.js';
import { criteria } from './models.js';

type Sport = 'run' | 'cycle' | 'swim' | 'strength';
const BRIEF_ORDER: Sport[] = ['run', 'cycle', 'swim', 'strength'];
const ZONE: Record<Exclude<Sport, 'strength'>, string> = {
  run: 'easy',
  cycle: 'endurance',
  swim: 'endurance',
};
/** Placeholder calibrations for sports the athlete has no evidence for, labelled as estimates. */
const ESTIMATES = {
  run: { system: 'run_pace', input: { method: 'threshold_pace', secondsPerKilometre: 360 } },
  cycle: { system: 'cycle_power', input: { method: 'ftp', watts: 150 } },
  swim: { system: 'swim_pace', input: { method: 'css_pace', secondsPer100Metres: 150 } },
} as const;

function brief(scenario: Scenario) {
  const persona = scenario.persona;
  const answer = (value: number | null) =>
    value === null ? { status: 'unknown', value: null } : { status: 'known', value };
  const sports = BRIEF_ORDER.flatMap((name) => {
    const sport = persona.sports.find((item) => item.sport === name);
    if (!sport) return [];
    const common = {
      sport: sport.sport,
      currentSessions: answer(sport.currentSessions),
      desiredSessions: sport.desiredSessions,
    };
    if (sport.sport === 'cycle')
      return [
        {
          ...common,
          weeklyDuration: answer(sport.weeklyDurationSeconds),
          longestDuration: answer(sport.longestDurationSeconds),
        },
      ];
    if (sport.sport === 'run' || sport.sport === 'swim')
      return [
        {
          ...common,
          weeklyDistance: answer(sport.weeklyDistanceMetres),
          longestDistance: answer(sport.longestDistanceMetres),
        },
      ];
    return [common];
  });
  return {
    goal: scenario.facts.goal!,
    unit: 'kilometres',
    context: `Scripted fixture for ${scenario.id}; prescribe the first ${scenario.prescriptionWeeks} weeks now.`,
    sports,
    weekdays: Array.from({ length: 7 }, (_, index) => {
      const slot = persona.availability.find((day) => day.weekday === index + 1);
      return slot ? (slot.preferred ? 'preferred' : 'available') : 'unavailable';
    }),
  };
}

/** Greedily places each sport's sessions on allowed days within their time and facility limits. */
function weekWorkouts(scenario: Scenario, weekKey: string, weekStart: string, index: number) {
  const persona = scenario.persona;
  const used = new Map<number, { minutes: number; sports: Sport[] }>();
  const workouts = [];
  const availableSlots = (sport: (typeof persona.sports)[number]) => {
    const access = persona.accessRestrictions.find((item) => item.sport === sport.sport);
    return persona.availability.filter((day) => !access || access.weekdays.includes(day.weekday))
      .length;
  };
  // Reserve limited facility slots before flexible sports occupy their time budget.
  for (const sport of [...persona.sports].sort((a, b) => availableSlots(a) - availableSlots(b))) {
    const access = persona.accessRestrictions.find((item) => item.sport === sport.sport);
    for (let session = 0; session < sport.desiredSessions; session++) {
      const slot = persona.availability.find((day) => {
        const state = used.get(day.weekday) ?? { minutes: 0, sports: [] };
        return (
          state.sports.length < 2 &&
          !state.sports.includes(sport.sport) &&
          day.maxMinutes - state.minutes >= 20 &&
          (!access || access.weekdays.includes(day.weekday))
        );
      });
      if (!slot)
        throw new Error(
          `Scripted fixture cannot fit ${sport.desiredSessions} ${sport.sport} sessions.`,
        );
      const state = used.get(slot.weekday) ?? { minutes: 0, sports: [] };
      const minutes = Math.min(40, slot.maxMinutes - state.minutes, access?.maxMinutes ?? 40);
      used.set(slot.weekday, {
        minutes: state.minutes + minutes,
        sports: [...state.sports, sport.sport],
      });
      const step =
        sport.sport === 'strength'
          ? {
              completion: { type: 'repetitions', value: 10, unit: 'repetitions' },
              targets: [{ type: 'rir', value: 3 }],
              label: 'Goblet squat',
            }
          : {
              completion: { type: 'duration', value: minutes * 60, unit: 'seconds' },
              targets: [{ type: 'zone', key: ZONE[sport.sport] }],
              label: `Easy ${sport.sport}`,
            };
      workouts.push({
        key: `${sport.sport}-${index}-${session}`,
        weekKey,
        date: addDays(weekStart, slot.weekday - 1),
        position: state.sports.length + 1,
        discipline: sport.sport,
        title: `Easy ${sport.sport} session`,
        description: null,
        purpose: 'Scripted fixture session.',
        priority: 'medium',
        racePriority: null,
        estimatedDurationSeconds: minutes * 60,
        estimatedDistanceMetres: null,
        tags: [],
        steps: [
          {
            parentIndex: null,
            kind: 'effort',
            repeatCount: null,
            role: 'main',
            instructions: 'Keep the effort comfortable.',
            ...step,
          },
        ],
      });
    }
  }
  return workouts;
}

/** A provider-neutral script, so the offline benchmark runs through either coach runtime. */
export function scriptedCoach(scenario: Scenario): ScriptedTurn[] {
  const reply = (text: string): ScriptedTurn => ({ type: 'reply', text });
  const call = (name: string, input: Record<string, unknown>): ScriptedTurn => ({
    type: 'tools',
    calls: [{ name, input }],
  });
  const weeks = Array.from({ length: scenario.prescriptionWeeks }, (_, i) => ({
    key: `week-${i}`,
    blockKey: 'base',
    title: `Week ${i + 1}`,
    description: null,
    startDate: addDays(scenario.dates.startDate, i * 7),
    endDate: addDays(scenario.dates.startDate, i * 7 + 6),
    position: i + 1,
    weekNumber: i + 1,
    cutback: false,
  }));
  const calibrations = scenario.persona.sports.flatMap((sport) => {
    if (sport.sport === 'strength') return [];
    const evidence = scenario.evidence.find(
      (item) => ESTIMATES[sport.sport].system === item.system,
    );
    return [
      evidence
        ? call('record_performance', {
            system: evidence.system,
            input: evidence.input,
            provenance: 'user_supplied',
            observedOn: evidence.observedOn,
            estimateBasis: 'Athlete reported this measured result.',
          })
        : call('record_performance', {
            ...ESTIMATES[sport.sport],
            provenance: 'agent_estimate',
            observedOn: null,
            estimateBasis: 'Scripted placeholder estimate; no measured result was disclosed.',
          }),
    ];
  });
  return [
    reply(
      'Please share your goal, dates, training history, available days, recent results and preferred planning horizon.',
    ),
    call('create_plan_draft', {
      displayName: `Scripted ${scenario.id}`,
      startDate: scenario.dates.startDate,
      endDate: scenario.dates.endDate,
    }),
    ...calibrations,
    call('update_plan_brief', {
      startDate: scenario.dates.startDate,
      endDate: scenario.dates.endDate,
      description: `First ${scenario.prescriptionWeeks} weeks of a ${scenario.planSpanWeeks}-week plan.`,
      brief: brief(scenario),
    }),
    call('apply_schedule_changes', {
      generation: { startDate: scenario.dates.startDate, endDate: scenario.dates.coverageEndDate },
      coverage: { startDate: scenario.dates.startDate, endDate: scenario.dates.coverageEndDate },
      blocks: [
        {
          key: 'base',
          title: 'Foundation',
          description: null,
          phase: 'base',
          startDate: scenario.dates.startDate,
          endDate: scenario.dates.coverageEndDate,
          position: 1,
        },
      ],
      weeks,
      workouts: weeks.flatMap((week, index) =>
        weekWorkouts(scenario, week.key, week.startDate, index),
      ),
      deleteWorkoutIds: [],
      deleteWeekIds: [],
      deleteBlockIds: [],
    }),
    call('validate_plan', {}),
    reply(
      `The first ${scenario.prescriptionWeeks} weeks are saved. This response was generated by an offline scripted fixture.`,
    ),
  ];
}

export function scriptedReview(snapshot: BenchmarkSnapshot): Review {
  return {
    verdict: 'needs_revision',
    summary:
      'Offline fixture verifies persistence and report wiring. It does not assess model quality.',
    criteria: criteria.map((criterion) => ({
      criterion,
      result: 'uncertain',
      explanation: 'No live reviewer ran.',
      evidence: snapshot.messages.length
        ? [`message:${snapshot.messages[0]!.sequence}`]
        : ['plan:brief'],
    })),
  };
}

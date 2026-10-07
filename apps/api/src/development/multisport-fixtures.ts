import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database/client.js';
import { getPerformance, recordCalibration } from '../modules/performance/performance.service.js';
import { confirmBrief, getBrief, saveBrief } from '../modules/plans/brief.service.js';
import { emptyBrief, type Brief } from '../modules/plans/brief.schemas.js';
import type { StepDiscipline, WorkoutDiscipline } from '../modules/plans/disciplines.js';
import { getPlan, lockPlan, organizePlan, previewLock } from '../modules/plans/plan.service.js';

/**
 * Development-only multi-sport sample plans for the synthetic athlete: an Olympic triathlon with
 * strength, and Hyrox with strength. They share the Cardiff fixture's May 2026 weeks so every
 * sport can be inspected beside the running plan.
 */
type Target =
  | { zone: string }
  | { pace: number }
  | { swimPace: number }
  | { power: number }
  | { rpe: number }
  | { rir: number }
  | { load: number };
type Completion = { seconds: number } | { metres: number } | { reps: number };
type Step = {
  sport?: StepDiscipline | undefined;
  role?: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'transition' | 'main';
  label?: string;
  instructions?: string;
  repeat?: number;
  steps?: Step[];
  completion?: Completion;
  targets?: Target[];
};
type Workout = {
  date: string;
  sport: WorkoutDiscipline;
  title: string;
  purpose: string;
  priority?: 'low' | 'medium' | 'high';
  minutes: number;
  metres?: number;
  steps: Step[];
};
type PlanSpec = {
  planId: string;
  versionId: string;
  name: string;
  description: string;
  brief: Brief;
  weeks: { title: string; workouts: Workout[] }[];
};

const min = (value: number): Completion => ({ seconds: value * 60 });
const rest = (seconds: number, sport?: StepDiscipline): Step => ({
  sport,
  role: 'recovery',
  label: 'Rest',
  completion: { seconds },
});
const set = (sets: number, lift: Step, restSeconds: number): Step => ({
  repeat: sets,
  label: `${sets} sets`,
  steps: [{ role: 'work', ...lift }, rest(restSeconds)],
});
const known = (value: number) => ({ status: 'known' as const, value });
const allDays = Array<Brief['weekdays'][number]>(7).fill('available');

const triathlon: PlanSpec = {
  planId: '00000000-0000-0000-0000-000000000011',
  versionId: '00000000-0000-0000-0000-000000000061',
  name: 'Olympic Triathlon 2026',
  description: 'A two-week multi-sport example: swim, bike, run, bricks and supporting strength.',
  brief: {
    ...emptyBrief(),
    goal: 'Finish an Olympic-distance triathlon strongly, with strength work to stay robust.',
    sports: [
      {
        sport: 'run',
        currentSessions: known(3),
        desiredSessions: 3,
        weeklyDistance: known(25000),
        longestDistance: known(12000),
      },
      {
        sport: 'cycle',
        currentSessions: known(2),
        desiredSessions: 2,
        weeklyDuration: known(14400),
        longestDuration: known(7200),
      },
      {
        sport: 'swim',
        currentSessions: known(2),
        desiredSessions: 3,
        weeklyDistance: known(4000),
        longestDistance: known(2500),
      },
      { sport: 'strength', currentSessions: known(1), desiredSessions: 1 },
    ],
    weekdays: allDays,
    context: 'Pool sessions before work; long ride and brick at the weekend.',
  },
  weeks: [
    {
      title: 'Build the routine',
      workouts: [
        {
          date: '2026-05-11',
          sport: 'swim',
          title: 'CSS intervals',
          purpose: 'Raise threshold swim speed with short, controlled repeats.',
          priority: 'high',
          minutes: 45,
          metres: 2000,
          steps: [
            {
              role: 'warmup',
              label: 'Easy swim',
              completion: { metres: 300 },
              targets: [{ zone: 'recovery' }],
            },
            {
              repeat: 4,
              label: 'Drill',
              steps: [
                {
                  role: 'work',
                  label: 'Catch-up drill',
                  completion: { metres: 50 },
                  targets: [{ zone: 'endurance' }],
                },
                rest(15),
              ],
            },
            {
              repeat: 8,
              label: 'Main set',
              steps: [
                {
                  role: 'work',
                  label: '100 at CSS',
                  instructions: 'Leave on 1:55; hold the same time on every repeat.',
                  completion: { metres: 100 },
                  targets: [{ zone: 'threshold' }],
                },
                rest(15),
              ],
            },
            {
              role: 'cooldown',
              label: 'Easy swim',
              completion: { metres: 300 },
              targets: [{ zone: 'recovery' }],
            },
          ],
        },
        {
          date: '2026-05-12',
          sport: 'cycle',
          title: 'Sweet spot 2 × 15',
          purpose: 'Sustained power close to threshold with manageable fatigue.',
          priority: 'high',
          minutes: 60,
          steps: [
            {
              role: 'warmup',
              label: 'Spin up',
              completion: min(15),
              targets: [{ zone: 'endurance' }],
            },
            {
              repeat: 2,
              steps: [
                {
                  role: 'work',
                  label: 'Sweet spot',
                  completion: min(15),
                  targets: [{ zone: 'sweet_spot' }, { rpe: 7 }],
                },
                {
                  role: 'recovery',
                  label: 'Easy spin',
                  completion: min(5),
                  targets: [{ zone: 'recovery' }],
                },
              ],
            },
            {
              role: 'cooldown',
              label: 'Easy spin',
              completion: min(5),
              targets: [{ zone: 'recovery' }],
            },
          ],
        },
        {
          date: '2026-05-13',
          sport: 'run',
          title: 'Easy run and strides',
          purpose: 'Aerobic running with relaxed leg speed.',
          minutes: 45,
          metres: 7500,
          steps: [
            { role: 'main', label: 'Easy run', completion: min(40), targets: [{ zone: 'easy' }] },
            {
              repeat: 4,
              label: 'Strides',
              steps: [
                {
                  role: 'work',
                  label: 'Stride',
                  completion: { seconds: 20 },
                  targets: [{ rpe: 8 }],
                },
                {
                  role: 'recovery',
                  label: 'Walk back',
                  completion: { seconds: 60 },
                  targets: [{ zone: 'easy' }],
                },
              ],
            },
          ],
        },
        {
          date: '2026-05-14',
          sport: 'strength',
          title: 'Lower-body strength',
          purpose: 'Heavy, low-rep lifting for running economy and durability.',
          minutes: 45,
          steps: [
            set(
              3,
              { label: 'Back squat', completion: { reps: 6 }, targets: [{ rir: 2 }, { load: 60 }] },
              120,
            ),
            set(
              3,
              {
                label: 'Romanian deadlift',
                completion: { reps: 8 },
                targets: [{ rir: 2 }, { load: 50 }],
              },
              90,
            ),
            set(
              3,
              { label: 'Split squat (each leg)', completion: { reps: 8 }, targets: [{ rir: 2 }] },
              60,
            ),
            set(2, { label: 'Calf raise', completion: { reps: 15 }, targets: [{ rir: 1 }] }, 45),
          ],
        },
        {
          date: '2026-05-15',
          sport: 'swim',
          title: 'Endurance swim',
          purpose: 'Steady aerobic swimming at race-relevant volume.',
          minutes: 45,
          metres: 2000,
          steps: [
            {
              role: 'warmup',
              label: 'Easy swim',
              completion: { metres: 400 },
              targets: [{ zone: 'recovery' }],
            },
            {
              repeat: 3,
              steps: [
                {
                  role: 'work',
                  label: '400 steady',
                  completion: { metres: 400 },
                  targets: [{ zone: 'endurance' }],
                },
                rest(30),
              ],
            },
            {
              role: 'cooldown',
              label: 'Easy swim',
              completion: { metres: 400 },
              targets: [{ zone: 'recovery' }],
            },
          ],
        },
        {
          date: '2026-05-16',
          sport: 'mixed',
          title: 'Bike to run brick',
          purpose: 'Practise running on tired legs straight off the bike.',
          priority: 'high',
          minutes: 100,
          steps: [
            {
              sport: 'cycle',
              role: 'warmup',
              label: 'Easy ride',
              completion: min(20),
              targets: [{ zone: 'endurance' }],
            },
            {
              repeat: 3,
              steps: [
                {
                  sport: 'cycle',
                  role: 'work',
                  label: 'Tempo',
                  completion: min(8),
                  targets: [{ zone: 'tempo' }, { rpe: 6 }],
                },
                {
                  sport: 'cycle',
                  role: 'recovery',
                  label: 'Easy',
                  completion: min(4),
                  targets: [{ zone: 'endurance' }],
                },
              ],
            },
            {
              sport: 'cycle',
              role: 'main',
              label: 'Steady ride',
              completion: min(20),
              targets: [{ zone: 'endurance' }],
            },
            {
              sport: 'other',
              role: 'transition',
              label: 'T2',
              instructions: 'Rack the bike and change shoes quickly.',
              completion: min(2),
            },
            {
              sport: 'run',
              role: 'work',
              label: 'Run off the bike',
              completion: min(20),
              targets: [{ zone: 'marathon' }],
            },
          ],
        },
        {
          date: '2026-05-17',
          sport: 'run',
          title: 'Long run',
          purpose: 'Aerobic endurance for the 10 km leg.',
          minutes: 70,
          metres: 12000,
          steps: [
            {
              role: 'main',
              label: 'Long easy run',
              completion: min(70),
              targets: [{ zone: 'easy' }],
            },
          ],
        },
      ],
    },
    {
      title: 'Benchmarks',
      workouts: [
        {
          date: '2026-05-18',
          sport: 'swim',
          title: 'CSS test',
          purpose: 'An all-out 400 and 200 to refresh swim paces.',
          priority: 'high',
          minutes: 40,
          metres: 1500,
          steps: [
            {
              role: 'warmup',
              label: 'Easy swim with builds',
              completion: { metres: 400 },
              targets: [{ zone: 'recovery' }],
            },
            {
              role: 'work',
              label: '400 all-out',
              completion: { metres: 400 },
              targets: [{ rpe: 10 }],
            },
            {
              role: 'recovery',
              label: 'Easy swim',
              completion: min(8),
              targets: [{ zone: 'recovery' }],
            },
            {
              role: 'work',
              label: '200 all-out',
              completion: { metres: 200 },
              targets: [{ rpe: 10 }],
            },
            {
              role: 'cooldown',
              label: 'Easy swim',
              completion: { metres: 300 },
              targets: [{ zone: 'recovery' }],
            },
          ],
        },
        {
          date: '2026-05-19',
          sport: 'cycle',
          title: 'VO2 max 5 × 3',
          purpose: 'Hard aerobic intervals to lift the ceiling.',
          priority: 'high',
          minutes: 60,
          steps: [
            {
              role: 'warmup',
              label: 'Spin up',
              completion: min(15),
              targets: [{ zone: 'endurance' }],
            },
            {
              repeat: 5,
              steps: [
                {
                  role: 'work',
                  label: 'VO2 max',
                  completion: min(3),
                  targets: [{ zone: 'vo2max' }, { rpe: 9 }],
                },
                {
                  role: 'recovery',
                  label: 'Easy spin',
                  completion: min(3),
                  targets: [{ zone: 'recovery' }],
                },
              ],
            },
            {
              role: 'cooldown',
              label: 'Easy spin',
              completion: min(15),
              targets: [{ zone: 'recovery' }],
            },
          ],
        },
        {
          date: '2026-05-20',
          sport: 'run',
          title: 'Threshold 3 × 10',
          purpose: 'Comfortably hard running for race-pace control.',
          minutes: 55,
          metres: 10000,
          steps: [
            { role: 'warmup', label: 'Easy jog', completion: min(12), targets: [{ zone: 'easy' }] },
            {
              repeat: 3,
              steps: [
                {
                  role: 'work',
                  label: 'Threshold',
                  completion: min(10),
                  targets: [{ zone: 'threshold' }],
                },
                { role: 'recovery', label: 'Jog', completion: min(2), targets: [{ zone: 'easy' }] },
              ],
            },
            {
              role: 'cooldown',
              label: 'Easy jog',
              completion: min(7),
              targets: [{ zone: 'easy' }],
            },
          ],
        },
        {
          date: '2026-05-21',
          sport: 'strength',
          title: 'Upper body and core',
          purpose: 'Pulling strength for the swim and a stable trunk on the bike.',
          minutes: 35,
          steps: [
            set(3, { label: 'Pull-up', completion: { reps: 6 }, targets: [{ rir: 2 }] }, 90),
            set(3, { label: 'Push-up', completion: { reps: 12 }, targets: [{ rir: 2 }] }, 60),
            set(
              3,
              { label: 'Front plank', completion: { seconds: 45 }, targets: [{ rpe: 6 }] },
              45,
            ),
          ],
        },
        {
          date: '2026-05-23',
          sport: 'mixed',
          title: 'Long brick',
          purpose: 'Race-day fuelling and pacing on a longer ride and run.',
          minutes: 120,
          steps: [
            {
              sport: 'cycle',
              role: 'main',
              label: 'Long ride',
              completion: min(90),
              targets: [{ zone: 'endurance' }],
            },
            { sport: 'other', role: 'transition', label: 'T2', completion: min(2) },
            {
              sport: 'run',
              role: 'main',
              label: 'Easy run',
              completion: min(28),
              targets: [{ zone: 'easy' }],
            },
          ],
        },
        {
          date: '2026-05-24',
          sport: 'swim',
          title: 'Continuous swim',
          purpose: 'Race-distance confidence without stopping.',
          minutes: 45,
          metres: 2000,
          steps: [
            {
              role: 'main',
              label: 'Continuous swim',
              completion: { metres: 1500 },
              targets: [{ zone: 'endurance' }],
            },
            {
              role: 'cooldown',
              label: 'Easy choice',
              completion: { metres: 500 },
              targets: [{ zone: 'recovery' }],
            },
          ],
        },
      ],
    },
  ],
};

const hyrox: PlanSpec = {
  planId: '00000000-0000-0000-0000-000000000012',
  versionId: '00000000-0000-0000-0000-000000000071',
  name: 'Hyrox London 2026',
  description: 'A two-week Hyrox example: running, stations, compromised running and strength.',
  brief: {
    ...emptyBrief(),
    goal: 'Race Hyrox Open with even splits and strong stations.',
    sports: [
      {
        sport: 'run',
        currentSessions: known(3),
        desiredSessions: 3,
        weeklyDistance: known(25000),
        longestDistance: known(10000),
      },
      { sport: 'strength', currentSessions: known(2), desiredSessions: 3 },
    ],
    weekdays: allDays,
    context: 'Trains at a gym with a sled, SkiErg and rower.',
  },
  weeks: [
    {
      title: 'Stations and engine',
      workouts: [
        {
          date: '2026-05-11',
          sport: 'strength',
          title: 'Station strength',
          purpose: 'Heavy sled work and grip under fatigue.',
          priority: 'high',
          minutes: 50,
          steps: [
            set(
              4,
              {
                label: 'Sled push',
                completion: { metres: 25 },
                targets: [{ rpe: 8 }, { load: 102 }],
              },
              90,
            ),
            set(
              4,
              { label: 'Wall balls', completion: { reps: 20 }, targets: [{ rpe: 7 }, { load: 6 }] },
              60,
            ),
            set(
              4,
              {
                label: 'Farmers carry',
                completion: { metres: 50 },
                targets: [{ rpe: 7 }, { load: 24 }],
              },
              60,
            ),
          ],
        },
        {
          date: '2026-05-13',
          sport: 'mixed',
          title: 'Compromised running',
          purpose: 'Run well straight off a station, as in the race.',
          priority: 'high',
          minutes: 55,
          steps: [
            {
              sport: 'run',
              role: 'warmup',
              label: 'Easy jog',
              completion: min(10),
              targets: [{ zone: 'easy' }],
            },
            {
              repeat: 4,
              label: 'Rounds',
              steps: [
                {
                  sport: 'run',
                  role: 'work',
                  label: '1 km run',
                  completion: { metres: 1000 },
                  targets: [{ zone: 'threshold' }],
                },
                {
                  sport: 'strength',
                  role: 'work',
                  label: 'Wall balls',
                  completion: { reps: 20 },
                  targets: [{ rpe: 8 }],
                },
                {
                  sport: 'row',
                  role: 'work',
                  label: 'Row',
                  completion: { metres: 500 },
                  targets: [{ rpe: 7 }],
                },
                rest(90, 'other'),
              ],
            },
          ],
        },
        {
          date: '2026-05-15',
          sport: 'strength',
          title: 'Lower-body strength',
          purpose: 'Strength reserve for the sled and lunges.',
          minutes: 45,
          steps: [
            set(
              5,
              { label: 'Deadlift', completion: { reps: 5 }, targets: [{ rir: 2 }, { load: 100 }] },
              150,
            ),
            set(
              3,
              {
                label: 'Walking lunge',
                completion: { reps: 20 },
                targets: [{ rir: 2 }, { load: 20 }],
              },
              90,
            ),
          ],
        },
        {
          date: '2026-05-16',
          sport: 'mixed',
          title: 'Half Hyrox simulation',
          purpose: 'Rehearse race order and pacing over the first four stations.',
          priority: 'high',
          minutes: 45,
          steps: [
            {
              sport: 'run',
              role: 'warmup',
              label: 'Easy jog',
              completion: min(8),
              targets: [{ zone: 'easy' }],
            },
            {
              sport: 'run',
              role: 'work',
              label: '1 km run',
              completion: { metres: 1000 },
              targets: [{ zone: 'marathon' }],
            },
            {
              sport: 'ski_erg',
              role: 'work',
              label: 'SkiErg',
              completion: { metres: 1000 },
              targets: [{ rpe: 7 }],
            },
            {
              sport: 'run',
              role: 'work',
              label: '1 km run',
              completion: { metres: 1000 },
              targets: [{ zone: 'marathon' }],
            },
            {
              sport: 'strength',
              role: 'work',
              label: 'Sled push',
              completion: { metres: 50 },
              targets: [{ rpe: 9 }],
            },
            {
              sport: 'run',
              role: 'work',
              label: '1 km run',
              completion: { metres: 1000 },
              targets: [{ zone: 'marathon' }],
            },
            {
              sport: 'strength',
              role: 'work',
              label: 'Sled pull',
              completion: { metres: 50 },
              targets: [{ rpe: 9 }],
            },
            {
              sport: 'run',
              role: 'work',
              label: '1 km run',
              completion: { metres: 1000 },
              targets: [{ zone: 'marathon' }],
            },
            {
              sport: 'strength',
              role: 'work',
              label: 'Burpee broad jumps',
              completion: { metres: 80 },
              targets: [{ rpe: 8 }],
            },
          ],
        },
      ],
    },
    {
      title: 'Speed and strength',
      workouts: [
        {
          date: '2026-05-19',
          sport: 'run',
          title: 'Intervals 6 × 800',
          purpose: 'Raise aerobic speed for the eight race kilometres.',
          minutes: 50,
          metres: 9000,
          steps: [
            { role: 'warmup', label: 'Easy jog', completion: min(12), targets: [{ zone: 'easy' }] },
            {
              repeat: 6,
              steps: [
                {
                  role: 'work',
                  label: '800 m',
                  completion: { metres: 800 },
                  targets: [{ zone: 'interval' }],
                },
                { role: 'recovery', label: 'Jog', completion: min(2), targets: [{ zone: 'easy' }] },
              ],
            },
            {
              role: 'cooldown',
              label: 'Easy jog',
              completion: min(8),
              targets: [{ zone: 'easy' }],
            },
          ],
        },
        {
          date: '2026-05-21',
          sport: 'strength',
          title: 'Upper body and carries',
          purpose: 'Pulling strength for the sled pull and rower.',
          minutes: 40,
          steps: [
            set(
              4,
              {
                label: 'Bent-over row',
                completion: { reps: 8 },
                targets: [{ rir: 2 }, { load: 50 }],
              },
              90,
            ),
            set(
              3,
              {
                label: 'Sandbag lunge',
                completion: { metres: 50 },
                targets: [{ rpe: 7 }, { load: 20 }],
              },
              90,
            ),
          ],
        },
        {
          date: '2026-05-23',
          sport: 'run',
          title: 'Long easy run',
          purpose: 'Aerobic base for a long race.',
          minutes: 60,
          metres: 10000,
          steps: [
            { role: 'main', label: 'Easy run', completion: min(60), targets: [{ zone: 'easy' }] },
          ],
        },
      ],
    },
  ],
};

const PLANS = [triathlon, hyrox];

function targetRow(target: Target, sport: StepDiscipline | undefined) {
  const none = { zone_system: null, zone_key: null, target_value: null, unit: null };
  if ('zone' in target) {
    const system = sport === 'cycle' ? 'cycle_power' : sport === 'swim' ? 'swim_pace' : 'run_pace';
    return { ...none, target_type: 'zone', zone_system: system, zone_key: target.zone };
  }
  if ('pace' in target)
    return {
      ...none,
      target_type: 'pace',
      target_value: target.pace,
      unit: 'seconds_per_kilometre',
    };
  if ('swimPace' in target)
    return {
      ...none,
      target_type: 'pace',
      target_value: target.swimPace,
      unit: 'seconds_per_100_metres',
    };
  if ('power' in target)
    return { ...none, target_type: 'power', target_value: target.power, unit: 'watts' };
  if ('rpe' in target)
    return { ...none, target_type: 'rpe', target_value: target.rpe, unit: 'rpe' };
  if ('rir' in target)
    return { ...none, target_type: 'rir', target_value: target.rir, unit: 'repetitions' };
  return { ...none, target_type: 'load', target_value: target.load, unit: 'kilograms' };
}

function completionRow(completion: Completion) {
  if ('seconds' in completion)
    return { completion_type: 'duration', numeric_value: completion.seconds, unit: 'seconds' };
  if ('metres' in completion)
    return { completion_type: 'distance', numeric_value: completion.metres, unit: 'metres' };
  return { completion_type: 'repetitions', numeric_value: completion.reps, unit: 'repetitions' };
}

async function insertPlan(owner: string, spec: PlanSpec) {
  const firstDate = spec.weeks[0]!.workouts[0]!.date;
  await getDatabase()
    .transaction()
    .execute(async (db) => {
      await db
        .insertInto('plans')
        .values({
          id: spec.planId,
          owner_id: owner,
          display_name: spec.name,
          current_draft_version_id: spec.versionId,
        })
        .execute();
      await db
        .insertInto('plan_versions')
        .values({
          id: spec.versionId,
          plan_id: spec.planId,
          description: spec.description,
          start_date: firstDate,
          end_date: '2026-09-27',
        })
        .execute();
      const blockId = randomUUID();
      await db
        .insertInto('training_blocks')
        .values({
          id: blockId,
          plan_version_id: spec.versionId,
          position: 1,
          title: 'Foundation',
          description: 'Establish every sport in the weekly routine.',
          start_date: firstDate,
          end_date: '2026-05-24',
        })
        .execute();
      for (const [index, week] of spec.weeks.entries()) {
        const weekId = randomUUID();
        const start = index === 0 ? '2026-05-11' : '2026-05-18';
        await db
          .insertInto('training_weeks')
          .values({
            id: weekId,
            plan_version_id: spec.versionId,
            block_id: blockId,
            week_number: index + 1,
            position: index + 1,
            title: week.title,
            description: null,
            start_date: start,
            end_date: index === 0 ? '2026-05-17' : '2026-05-24',
          })
          .execute();
        for (const workout of week.workouts) {
          const workoutId = randomUUID();
          await db
            .insertInto('workouts')
            .values({
              id: workoutId,
              plan_version_id: spec.versionId,
              week_id: weekId,
              scheduled_date: workout.date,
              position: 1,
              title: workout.title,
              description: null,
              purpose: workout.purpose,
              primary_discipline: workout.sport,
              priority: workout.priority ?? 'medium',
              estimated_duration_seconds: workout.minutes * 60,
              estimated_distance_metres: workout.metres ?? null,
            })
            .execute();
          const insertStep = async (step: Step, parent: string | null, position: number) => {
            const id = randomUUID();
            const kind = step.steps ? (step.repeat ? 'repeat' : 'sequence') : 'effort';
            const sport =
              kind === 'effort'
                ? (step.sport ?? (workout.sport === 'mixed' ? undefined : workout.sport))
                : undefined;
            await db
              .insertInto('workout_steps')
              .values({
                id,
                plan_version_id: spec.versionId,
                workout_id: workoutId,
                parent_step_id: parent,
                position,
                kind,
                role: step.role ?? null,
                discipline: sport ?? null,
                repeat_count: step.repeat ?? null,
                label: step.label ?? null,
                instructions: step.instructions ?? null,
              })
              .execute();
            if (step.completion)
              await db
                .insertInto('step_completions')
                .values({
                  step_id: id,
                  plan_version_id: spec.versionId,
                  ...completionRow(step.completion),
                })
                .execute();
            for (const [i, target] of (step.targets ?? []).entries())
              await db
                .insertInto('step_targets')
                .values({
                  step_id: id,
                  plan_version_id: spec.versionId,
                  position: i + 1,
                  ...targetRow(target, sport),
                })
                .execute();
            for (const [i, child] of (step.steps ?? []).entries())
              await insertStep(child, id, i + 1);
          };
          await insertStep({ steps: workout.steps }, null, 1);
        }
      }
    });
}

/** Cycling and swimming calibration for the synthetic athlete, alongside its race results. */
async function calibrate(owner: string) {
  const systems = new Set((await getPerformance(owner)).entries.map((entry) => entry.system));
  if (!systems.has('cycle_power'))
    await recordCalibration(
      owner,
      {
        system: 'cycle_power',
        input: { method: 'twenty_minute_test', averageWatts: 258 },
        observedOn: '2026-05-09',
      },
      new Date('2026-05-11T12:00:00Z'),
    );
  if (!systems.has('swim_pace'))
    await recordCalibration(
      owner,
      {
        system: 'swim_pace',
        input: { method: 'css_test', t400Seconds: 400, t200Seconds: 185 },
        observedOn: '2026-05-10',
      },
      new Date('2026-05-11T12:00:00Z'),
    );
}

export async function publishMultisportFixtures(owner: string) {
  await calibrate(owner);
  for (const spec of PLANS) {
    const existing = await getDatabase()
      .selectFrom('plans')
      .select('owner_id')
      .where('id', '=', spec.planId)
      .executeTakeFirst();
    if (existing && existing.owner_id !== owner)
      throw new Error('Multi-sport fixture plan belongs to another athlete.');
    if (!existing) await insertPlan(owner, spec);
    let plan = await getPlan(owner, spec.planId);
    if (!plan.locked) {
      let brief = await getBrief(owner, spec.planId);
      const command = () => ({
        expectedDraftId: brief.versionId,
        expectedEditNumber: brief.editNumber,
      });
      if (!brief.brief.goal)
        brief = await saveBrief(owner, spec.planId, { ...command(), brief: spec.brief });
      await confirmBrief(owner, spec.planId, {
        ...command(),
        expectedHash: brief.hash,
        acknowledgedWarningCodes: brief.findings
          .filter((f) => f.severity === 'warning')
          .map((f) => f.code),
      });
      const preview = await previewLock(owner, spec.planId);
      const errors = preview.findings.filter((finding) => finding.severity === 'error');
      if (errors.length)
        throw new Error(
          `Fixture ${spec.name} is invalid: ${errors.map((e) => e.message).join(' ')}`,
        );
      plan = await lockPlan(
        owner,
        spec.planId,
        {
          expectedStateVersion: preview.stateVersion,
          expectedDraftId: preview.draftId,
          expectedEditNumber: preview.editNumber,
          expectedContentHash: preview.contentHash,
          expectedValidationDigest: preview.validationDigest,
          acknowledgedWarningCodes: preview.findings
            .filter((finding) => finding.severity === 'warning')
            .map((finding) => finding.code),
        },
        `${spec.planId}-publication`,
      );
    }
    if (plan.locked?.versionNumber !== 1 || plan.draft || plan.archived)
      throw new Error(`Fixture ${spec.name} has been edited; refusing to change its lifecycle.`);
    if (!plan.active) await organizePlan(owner, spec.planId, 'activate', plan.stateVersion);
  }
}

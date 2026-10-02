import { buildFinalWeeks } from '../data/seed';
import { strengthSession } from '../data/builders';
import type { PlanChange, PlanMeta, PlanStatus, Workout } from '../data/types';
import { workoutTotals } from './metrics';
import { changeLabel, plannedThroughWeek, summarizeWeeks } from './plan-selectors';
import type { EditResult } from '../state/plan';

export type CoachTurn = {
  calls: string[];
  /** Applied once every tool call has finished. */
  edit?: (workouts: Workout[]) => EditResult;
  reply: string;
  summary?: string;
  unlockAction?: boolean;
};

type Snapshot = { meta: PlanMeta; workouts: Workout[]; status: PlanStatus; version: number };

export const SUGGESTIONS = [
  'Make my next hard session easier',
  'Plan the final two weeks',
  'Swap in a full-body strength day',
  'Make my next long run longer',
];

const EDIT_INTENTS = {
  easier: /(easier|too hard|too much|tired|fatigue|lighter|ease off|sore|knee|calf|shin)/i,
  finalWeeks:
    /(week(s)? ?(11|12|eleven|twelve)|final (two )?weeks|taper|rest of (the )?plan|race (week|day)|finish (off )?the plan|extend)/i,
  strength: /(strength|gym|weights|core|stability|full.?body)/i,
  longer: /(long run|longer|more (miles|mileage|distance))/i,
};

function detect(text: string): keyof typeof EDIT_INTENTS | null {
  // Order matters: "make it easier" beats generic words further down.
  for (const key of ['finalWeeks', 'easier', 'strength', 'longer'] as const) {
    if (EDIT_INTENTS[key].test(text)) return key;
  }
  return null;
}

const nextAfter = (workouts: Workout[], today: string, test: (w: Workout) => boolean) =>
  workouts.filter((w) => w.date > today && test(w)).sort((a, b) => a.date.localeCompare(b.date))[0];

const km = (m: number) => `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`;

function change(meta: PlanMeta, w: Workout, kind: PlanChange['kind']): PlanChange {
  return { workoutId: w.id, label: changeLabel(meta, w), kind };
}

function replaceOne(workouts: Workout[], next: Workout): Workout[] {
  return workouts.map((w) => (w.id === next.id ? next : w));
}

function easierTurn(snap: Snapshot, today: string): CoachTurn {
  const target = nextAfter(
    snap.workouts,
    today,
    (w) => w.kind === 'tempo' || w.kind === 'intervals',
  );
  if (!target) {
    return {
      calls: ['Reading the plan'],
      reply:
        'There are no hard sessions left in the drafted weeks, so there is nothing to soften yet. If the tiredness is from easy running, tell me how many days it has lasted and I will pull the whole week back instead.',
    };
  }
  const build = (w: Workout): { next: Workout; what: string } => {
    if (w.kind === 'intervals') {
      const rep = w.steps.find((s) => s.type === 'repeat');
      if (rep && rep.type === 'repeat') {
        const count = Math.max(3, rep.count - 1);
        const title = w.title.replace(/^\d+/, String(count));
        return {
          what: `one fewer repeat (${rep.count} → ${count})`,
          next: {
            ...w,
            title,
            steps: w.steps.map((s) => (s === rep ? { ...rep, count } : s)),
            change: w.change ?? 'changed',
            changeNote: `Dropped from ${rep.count} to ${count} repeats — same pace, less total volume.`,
          },
        };
      }
    }
    const trimmed = w.steps.map((s) => {
      if (s.type === 'repeat') {
        return {
          ...s,
          steps: s.steps.map((c) =>
            c.type === 'effort' && c.zone === 'tempo'
              ? { ...c, seconds: Math.max(480, (c.seconds ?? 0) - 150) }
              : c,
          ),
        };
      }
      return s.zone === 'tempo' ? { ...s, seconds: Math.max(600, (s.seconds ?? 0) - 300) } : s;
    });
    return {
      what: 'about five minutes less time at tempo',
      next: {
        ...w,
        steps: trimmed,
        change: w.change ?? 'changed',
        changeNote: 'Shortened the tempo block by roughly five minutes.',
      },
    };
  };
  const { next, what } = build(target);
  return {
    calls: [
      'Reading your plan brief',
      `Finding the next hard session (${changeLabel(snap.meta, target)})`,
      'Editing the draft',
    ],
    edit: (ws) => {
      const current = ws.find((w) => w.id === target.id) ?? target;
      const out = build(current).next;
      return {
        workouts: replaceOne(ws, out),
        changes: [change(snap.meta, out, out.change ?? 'changed')],
      };
    },
    summary: 'Softened your next hard session',
    reply: `Fair enough — I would rather trim a session than have you grind through it. I have made **${changeLabel(snap.meta, next)}** easier: ${what}. The paces and everything else in that week stay the same, so the shape of the block holds.\n\nIf the heaviness lasts more than a few days, tell me how your sleep and easy-run effort feel and we can pull the whole week back.`,
  };
}

function longerTurn(snap: Snapshot, today: string): CoachTurn {
  const target = nextAfter(snap.workouts, today, (w) => w.kind === 'long');
  if (!target) {
    return {
      calls: ['Reading the plan'],
      reply: 'I do not see an upcoming long run in the drafted weeks to extend.',
    };
  }
  const before = workoutTotals(target).meters;
  const after = Math.min(before + 2000, 22000);
  const build = (w: Workout) => ({
    ...w,
    steps: w.steps.map((s, i) =>
      i === 0 && s.type === 'effort' && s.meters
        ? { ...s, meters: s.meters + (after - before) }
        : s,
    ),
    change: w.change ?? ('changed' as const),
    changeNote: `Extended from ${km(before)} to ${km(after)}.`,
  });
  return {
    calls: [
      'Reading your plan brief',
      'Checking weekly volume and recent long runs',
      'Editing the draft',
    ],
    edit: (ws) => {
      const current = ws.find((w) => w.id === target.id) ?? target;
      const out = build(current);
      return {
        workouts: replaceOne(ws, out),
        changes: [change(snap.meta, out, out.change ?? 'changed')],
      };
    },
    summary: 'Extended your next long run',
    reply: `Done — **${changeLabel(snap.meta, target)}** goes from ${km(before)} to ${km(after)}, all of it easy running. That is a ${Math.round(((after - before) / before) * 100)}% jump on that run, which is at the upper end of what I like, so keep the first half genuinely patient.\n\nI left the rest of that week alone; if the extra distance leaves you flat, we can shorten Saturday's run instead.`,
  };
}

function strengthTurn(snap: Snapshot, today: string): CoachTurn {
  const target = nextAfter(snap.workouts, today, (w) => w.kind === 'strength');
  if (!target) {
    return {
      calls: ['Reading the plan'],
      reply: 'There is no upcoming strength session in the drafted weeks to swap.',
    };
  }
  const build = (w: Workout): Workout => ({
    ...strengthSession({ date: w.date }, 'full'),
    id: w.id,
    change: w.change ?? 'changed',
    changeNote: 'Swapped to the full-body variant: adds push-ups and dead bugs.',
  });
  return {
    calls: ['Reading your plan brief', 'Looking at the surrounding week', 'Editing the draft'],
    edit: (ws) => {
      const current = ws.find((w) => w.id === target.id) ?? target;
      const out = build(current);
      return {
        workouts: replaceOne(ws, out),
        changes: [change(snap.meta, out, out.change ?? 'changed')],
      };
    },
    summary: 'Swapped in a full-body strength day',
    reply: `Good call. **${changeLabel(snap.meta, target)}** is now the full-body version — the same single-leg work, plus push-ups and dead bugs for upper-body balance. It takes about five minutes longer.\n\nKeep two reps in reserve on every set; the goal is to feel stronger on Thursday's run, not sore.`,
  };
}

function finalWeeksTurn(snap: Snapshot): CoachTurn {
  const summaries = summarizeWeeks(snap.meta, snap.workouts);
  const through = plannedThroughWeek(summaries);
  if (through >= snap.meta.totalWeeks) {
    return {
      calls: ['Reading the plan'],
      reply:
        'Every week through race day is already prescribed. Tell me which one you would like to change and I will adjust it.',
    };
  }
  const created = buildFinalWeeks(snap.meta.startDate, snap.meta.raceName);
  return {
    calls: [
      'Reading your plan brief',
      'Checking pace guides and the 10K result',
      'Writing weeks 11–12',
      'Validating weekly load',
    ],
    edit: (ws) => {
      const ids = new Set(ws.map((w) => w.date));
      const fresh = created.filter((w) => !ids.has(w.date));
      return {
        workouts: [...ws, ...fresh],
        changes: fresh.filter((w) => w.change).map((w) => change(snap.meta, w, 'new')),
      };
    },
    summary: 'Drafted weeks 11–12 through race day',
    reply: `I have drafted the final two weeks. **Week 11** keeps one more quality week — a tempo session split in two and a long run that finishes at goal pace — and then **week 12** is the taper: volume drops by about 40%, but there is still one short interval session so your legs stay sharp.\n\n- Race-week Saturday is a 3 km shakeout\n- ${snap.meta.raceName} is on the Sunday, with goal pace set at 4:58 /km\n\nThe plan now runs all the way to race day. Swipe across to the plan page to review it, then lock when you are happy.`,
  };
}

const FALLBACKS = [
  'That is useful context, thank you. I have not changed anything yet. How did your last two easy runs feel in terms of effort — could you hold a full conversation? That tells me whether the current paces are right before I touch the plan.',
  'Good question. In short: consistency over the next few weeks matters far more than any single session. If you would like me to change something specific, tell me which workout and what you would like different, and I will draft it for you to review.',
  'Understood. Before I edit anything, one question: is this about how a session felt, or about fitting the plan around something in your schedule? The answer changes whether I adjust intensity or just move things around.',
];

export function planCoachTurn(
  text: string,
  snap: Snapshot,
  today: string,
  turnIndex: number,
): CoachTurn {
  const intent = detect(text);
  if (!intent) {
    return { calls: [], reply: FALLBACKS[turnIndex % FALLBACKS.length] };
  }
  if (snap.status === 'locked') {
    return {
      calls: ['Reading the plan'],
      reply: `I can do that, but plan v${snap.version} is **locked**, and only you can unlock it. Unlock it to open a new draft and I will make the change straight away.`,
      unlockAction: true,
    };
  }
  switch (intent) {
    case 'easier':
      return easierTurn(snap, today);
    case 'longer':
      return longerTurn(snap, today);
    case 'strength':
      return strengthTurn(snap, today);
    case 'finalWeeks':
      return finalWeeksTurn(snap);
  }
}

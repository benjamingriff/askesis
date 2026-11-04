import { changeLabel, changedWorkouts } from '../lib/plan-selectors';
import type { Conversation, Message, PlanMeta, Workout } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let seq = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const user = (id: string, at: number, text: string): Message => ({
  id,
  role: 'user',
  createdAt: at,
  status: 'done',
  parts: [{ type: 'text', text }],
});

const coach = (id: string, at: number, parts: Message['parts']): Message => ({
  id,
  role: 'assistant',
  createdAt: at,
  status: 'done',
  parts,
});

export const GREETING =
  'Hi, I am your coach. Tell me how training is going, what hurts, or what you would like to change about the plan — I will ask before I make big changes, and you always review before anything is locked.';

export function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: newId('chat'),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    archived: false,
    run: 'idle',
    unread: false,
    messages: [coach(newId('msg'), now, [{ type: 'text', text: GREETING }])],
  };
}

export function buildSeedConversations(
  meta: PlanMeta,
  workouts: Workout[],
  now = Date.now(),
): Conversation[] {
  const changes = changedWorkouts(workouts).map((w) => ({
    workoutId: w.id,
    label: changeLabel(meta, w),
    kind: w.change ?? ('changed' as const),
  }));

  const draftThread: Conversation = {
    id: 'c-extend',
    title: 'Build the next block around my 10K',
    createdAt: now - 3 * HOUR,
    updatedAt: now - 22 * MIN,
    archived: false,
    run: 'idle',
    unread: true,
    messages: [
      user(
        'm1',
        now - 3 * HOUR,
        'Weeks 1–4 went really well, I hit every session. Can you build the next block? I have a 10K on the Saturday of week 7 and I want to race it properly.',
      ),
      coach('m2', now - 3 * HOUR + MIN, [
        {
          type: 'text',
          text: 'Strong start — consistency like that is what makes the next block possible. Before I write anything, two quick questions so I get it right:\n\n- How did the Thursday tempos feel at 5:05 /km — controlled, or right on the edge?\n- Is the 10K a full-effort race, or more of a hard training run?',
        },
      ]),
      user(
        'm3',
        now - 2 * HOUR - 40 * MIN,
        'Controlled mostly, the last one was on the edge. It is a full race, I want a proper taper into it.',
      ),
      coach('m4', now - 2 * HOUR - 38 * MIN, [
        {
          type: 'activity',
          seconds: 7,
          calls: [
            { id: 't1', label: 'Reading your plan brief', status: 'done' },
            {
              id: 't2',
              label: 'Checking pace guides (estimated threshold 4:50 /km)',
              status: 'done',
            },
            { id: 't3', label: 'Editing weeks 6–10', status: 'done' },
            { id: 't4', label: 'Validating weekly load', status: 'done' },
          ],
        },
        {
          type: 'text',
          text: 'That helps a lot. I have drafted **weeks 9–10** of the peak block and reshaped **weeks 6–7** around your 10K:\n\n- Week 6: long run trimmed by 1 km so you arrive at week 7 fresher\n- Week 7: easy strides on Thursday, then the 10K on Saturday as a proper race\n- Week 8 drops back as a recovery week, as before\n\nI stopped at week 10 on purpose. Your 10K will give us a real race result, and I would rather build weeks 11–12 on that than on an estimate.',
        },
        {
          type: 'planUpdate',
          summary: `${changes.filter((c) => c.kind === 'new').length} new workouts · ${changes.filter((c) => c.kind === 'changed').length} edited`,
          changes,
        },
      ]),
      user('m5', now - 22 * MIN, 'Makes sense. Let me look at the plan.'),
      coach('m6', now - 22 * MIN + 20_000, [
        {
          type: 'text',
          text: 'Take your time. Swipe across to the plan page to see every change highlighted, and when you are happy, **Review & lock** freezes the plan. After the 10K, come back and we will plan the final two weeks together.',
        },
      ]),
    ],
  };

  const tempoThread: Conversation = {
    id: 'c-tempo',
    title: 'Tempo pace feels too hot',
    createdAt: now - 4 * DAY,
    updatedAt: now - 3 * DAY - 5 * HOUR,
    archived: false,
    run: 'idle',
    unread: false,
    messages: [
      user(
        't1',
        now - 4 * DAY,
        'The 5:00 tempo paces in weeks 2–3 felt way too hot for me. Is my threshold estimate off?',
      ),
      coach('t2', now - 4 * DAY + MIN, [
        {
          type: 'text',
          text: 'Possibly — your threshold was an **estimate** from your 10K time, not a measured result, so it is quite plausible it was a touch optimistic. I would rather re-base it than have you grind.',
        },
        {
          type: 'activity',
          seconds: 5,
          calls: [
            { id: 'a1', label: 'Recalibrating running pace guides', status: 'done' },
            { id: 'a2', label: 'Recomputing zones from 4:50 /km threshold', status: 'done' },
          ],
        },
        {
          type: 'text',
          text: 'I have set your threshold at **4:50 /km**, which moves tempo to 4:58–5:10. The workouts did not change — they are written as zones, so they now resolve to the new paces from today forward.',
        },
      ]),
      user('t3', now - 3 * DAY - 5 * HOUR, 'Perfect, that feels right. Thanks!'),
    ],
  };

  const archived: Conversation = {
    id: 'c-brief',
    title: 'Starting my half-marathon plan',
    createdAt: now - 31 * DAY,
    updatedAt: now - 30 * DAY,
    archived: true,
    run: 'idle',
    unread: false,
    messages: [
      user(
        'b1',
        now - 31 * DAY,
        'I want to run a half marathon in 12 weeks. Best 10K is 48:30, I run four times a week.',
      ),
      coach('b2', now - 31 * DAY + MIN, [
        {
          type: 'text',
          text: 'Great base to build from. A sub-1:45 goal is realistic for that 10K time if we protect your long run and keep easy days easy. Which days are best for you, and are you happy to add a short strength session?',
        },
      ]),
    ],
  };

  return [draftThread, tempoThread, archived];
}

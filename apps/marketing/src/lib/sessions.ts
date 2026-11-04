import type { IconName } from './icons';

export type Effort = 'recovery' | 'easy' | 'steady' | 'threshold' | 'hard' | 'max';

export type Session = {
  icon: IconName;
  kind: string;
  effort: Effort;
  title: string;
  meta: string;
};

/** Sessions in the style of the app's multisport example, for the marquee. */
export const sessions: Session[] = [
  {
    icon: 'waves',
    kind: 'Aerobic swim',
    effort: 'easy',
    title: 'Swim technique and endurance',
    meta: '1,800 m · 45 min',
  },
  {
    icon: 'bike',
    kind: 'Endurance ride',
    effort: 'easy',
    title: 'Endurance ride and cadence',
    meta: '1h 30 · 137–184 W',
  },
  {
    icon: 'footprints',
    kind: 'Threshold run',
    effort: 'threshold',
    title: '4 × 8 min at threshold',
    meta: '10 km · 4:56–5:05/km',
  },
  {
    icon: 'dumbbell',
    kind: 'Strength',
    effort: 'steady',
    title: 'Full body supporting strength',
    meta: '3 × 8 · 2 reps in reserve',
  },
  {
    icon: 'layers',
    kind: 'Brick',
    effort: 'steady',
    title: 'Bike → run brick',
    meta: '1h 10 · transition practice',
  },
  {
    icon: 'ship',
    kind: 'Hyrox',
    effort: 'hard',
    title: 'Hyrox stations and compromised running',
    meta: '8 × 1 km + stations',
  },
  {
    icon: 'waves',
    kind: 'CSS swim',
    effort: 'threshold',
    title: 'CSS swim intervals',
    meta: '10 × 100 m · 1:48/100 m',
  },
  {
    icon: 'bike',
    kind: 'Recovery ride',
    effort: 'recovery',
    title: 'Recovery spin',
    meta: '40 min · under 123 W',
  },
  {
    icon: 'footprints',
    kind: 'Long run',
    effort: 'easy',
    title: 'Long run, last 20 at marathon pace',
    meta: '18 km · 6:16/km',
  },
  {
    icon: 'snowflake',
    kind: 'Conditioning',
    effort: 'steady',
    title: 'AMRAP 15 · mixed circuit',
    meta: 'Row · push-ups · SkiErg',
  },
  {
    icon: 'bike',
    kind: 'Test',
    effort: 'hard',
    title: '20-minute FTP test',
    meta: 'Sets your power zones',
  },
  {
    icon: 'trophy',
    kind: 'Race',
    effort: 'max',
    title: '5K club race',
    meta: 'B race · end of Build 1',
  },
];

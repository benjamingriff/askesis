export type Zone = 'recovery' | 'easy' | 'steady' | 'tempo' | 'threshold' | 'interval';

export type WorkoutKind =
  'easy' | 'recovery' | 'long' | 'tempo' | 'intervals' | 'strength' | 'race' | 'rest';

export type StepRole = 'warmup' | 'work' | 'recovery' | 'cooldown' | 'main';

/** Mirrors the API's step tree: efforts and repeats of efforts. */
export type EffortStep = {
  type: 'effort';
  role: StepRole;
  label: string;
  zone?: Zone;
  seconds?: number;
  meters?: number;
  detail?: string;
};

export type RepeatStep = {
  type: 'repeat';
  count: number;
  steps: Step[];
};

export type Step = EffortStep | RepeatStep;

export type ChangeFlag = 'new' | 'changed';

export type Workout = {
  id: string;
  /** ISO date, yyyy-mm-dd */
  date: string;
  kind: WorkoutKind;
  title: string;
  blurb: string;
  steps: Step[];
  coachNote?: string;
  change?: ChangeFlag;
  changeNote?: string;
};

export type PhaseName = 'Base' | 'Build' | 'Peak' | 'Taper';

export type Phase = {
  name: PhaseName;
  fromWeek: number;
  toWeek: number;
  blurb: string;
  color: string;
};

export type PlanStatus = 'draft' | 'locked';

export type PlanMeta = {
  name: string;
  goal: string;
  raceName: string;
  raceDate: string;
  startDate: string;
  totalWeeks: number;
  phases: Phase[];
};

// ---- Chat -----------------------------------------------------------------------------------

export type ToolCall = {
  id: string;
  label: string;
  status: 'running' | 'done';
};

export type PlanChange = {
  workoutId: string;
  label: string;
  kind: ChangeFlag;
};

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'activity'; calls: ToolCall[]; seconds?: number }
  | { type: 'planUpdate'; summary: string; changes: PlanChange[] }
  | { type: 'action'; action: 'unlock'; label: string; done?: boolean };

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  createdAt: number;
  status?: 'streaming' | 'done' | 'stopped';
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  run: 'idle' | 'running';
  unread: boolean;
  messages: Message[];
};

// Normalized shapes served by the results plugin. Raw benchmark artifacts vary by
// run outcome (interrupted runs lack an assessment, scripted runs lack review
// usage), so every field that may be absent is explicit here.

export type Verdict =
  'acceptable' | 'needs_revision' | 'incomplete' | 'assessment_unavailable' | 'running';

export type CriterionResult = 'pass' | 'fail' | 'uncertain';

export const CRITERIA = [
  'goal_fit',
  'progression',
  'recovery',
  'prescriptions',
  'personalization',
  'conversation',
] as const;

export type Criterion = (typeof CRITERIA)[number];

export interface CriterionJudgment {
  criterion: string;
  result: CriterionResult;
  explanation: string;
  evidence: string[];
}

export interface CheckOutcome {
  id: string;
  status: string;
  explanation: string;
  evidence: string[];
}

export interface TokenUsage {
  coachInput: number;
  coachOutput: number;
  evaluationInput: number;
  evaluationOutput: number;
}

export interface RunSummary {
  id: string;
  startedAt: string;
  durationMs: number | null;
  scenarioId: string;
  scenarioVersion: number | null;
  promptVersion: string | null;
  promptHash: string | null;
  /** Dataset persona and athlete voice; null for runs of the retired running-poc scenario. */
  personaId: string | null;
  voiceId: string | null;
  scenarioLabel: string | null;
  revision: string | null;
  workingTreeDirty: boolean;
  scripted: boolean;
  demo: boolean;
  coachModel: string;
  reasoning: string;
  simulatorModel: string | null;
  reviewerModel: string | null;
  reviewerVersion: string | null;
  verdict: Verdict;
  /** The model reviewer's own verdict, separate from the overall benchmark verdict. */
  reviewerVerdict: string | null;
  stopReason: string | null;
  stage: string | null;
  checks: { id: string; status: string }[];
  criteria: { criterion: string; result: CriterionResult }[];
  /** Share of deterministic checks and reviewer criteria that passed, 0–1. */
  score: number | null;
  tokens: TokenUsage;
  coachTurns: number;
  athleteMessages: number;
  toolCalls: number;
  toolFailures: number;
  workoutCount: number;
  planTitle: string | null;
  /** Behavioural statistics derived from the transcript and tool trace. */
  conversation: ConversationStats | null;
  flags: SessionFlag[];
  review: HumanReview | null;
}

export interface ConversationStats {
  athleteTurns: number;
  coachTurns: number;
  questions: number;
  maxQuestionsPerTurn: number;
  multiQuestionTurns: number;
  /** Athlete replies where the simulator had nothing relevant to disclose. */
  unanswerable: number;
  /** Athlete had to ask the coach to go ahead and create the plan. */
  nudges: number;
  factsDisclosed: string[];
  factsAvailable: string[];
  requiredFacts: string[];
  /** Facts disclosed again after an earlier disclosure. */
  repeatedFacts: number;
  /** Athlete turn (1-based) after which the first schedule was saved. */
  turnsToPlan: number | null;
  timeToPlanMs: number | null;
  briefEdits: number;
  scheduleWrites: number;
  validations: number;
  lookups: number;
  beliefMismatches: number;
  assumptions: number;
  medianTurnMs: number | null;
  maxTurnMs: number | null;
  medianFirstVisibleMs: number | null;
  coachWords: number;
}

export type FlagSeverity = 'critical' | 'warning' | 'info';

export interface SessionFlag {
  id: string;
  /** Stable category for counting the same failure mode across runs. */
  kind: string;
  kindLabel: string;
  severity: FlagSeverity;
  label: string;
  detail: string;
  /** Message sequence or other reference the flag points at. */
  ref: string | null;
}

export type HumanVerdict = 'fit' | 'needs_revision' | 'unfit';

export interface HumanReview {
  updatedAt: string;
  verdict: HumanVerdict | null;
  /** Agreement with the model reviewer per criterion. */
  criteria: Record<string, 'agree' | 'disagree'>;
  tags: string[];
  notes: string;
  /** Your 1–5 ratings of how the coach communicated; null where not rated. */
  communication: Record<CommunicationAspect, number | null>;
}

export const COMMUNICATION_ASPECTS = ['tone', 'clarity', 'adaptation'] as const;
export type CommunicationAspect = (typeof COMMUNICATION_ASPECTS)[number];

/** A phrase you tagged in a coach message, saved apart from the review form. */
export interface Highlight {
  sequence: number;
  quote: string;
  tag: string;
  createdAt: string;
}

export interface ConversationMessage {
  sequence: number;
  role: string;
  content: string;
  createdAt: string | null;
}

export interface ToolCall {
  operationId: string;
  at: string;
  name: string;
  kind: 'write' | 'read';
  status: string;
  elapsedMs: number | null;
  summary: string;
  input: unknown;
  result: unknown;
}

export interface CoachTurn {
  index: number;
  runId: string;
  /** Athlete message that triggered the turn. */
  triggerSequence: number | null;
  replySequence: number | null;
  status: string;
  failureCode: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  queueWaitMs: number | null;
  firstVisibleMs: number | null;
  modelMs: number[];
  toolMs: number[];
  inputTokens: number;
  outputTokens: number;
  questions: number;
  words: number;
  tools: ToolCall[];
  /** Interim text and tool calls in the order they happened, before the final reply. */
  steps: TurnStep[];
  /** False for older runs without saved text times; text is then shown before tools. */
  stepsOrdered: boolean;
}

export type TurnStep =
  | { kind: 'text'; at: string | null; position: number; content: string }
  | { kind: 'tool'; at: string | null; position: number; operationId: string };

export interface Disclosure {
  sequence: number;
  factIds: string[];
  kind: 'answer' | 'nudge' | 'unknown';
  /** How the persona's voice step worded this message; null when it used the authored text. */
  voice: {
    id: string;
    status: 'voiced' | 'fallback' | 'skipped';
    attempts: number;
    /** The authored fact text the voiced message had to convey. */
    authored: string | null;
  } | null;
}

export type BeliefStatus = 'match' | 'mismatch' | 'assumed' | 'missing' | 'review';

export interface BeliefRow {
  field: string;
  label: string;
  factId: string;
  expected: string | null;
  recorded: string | null;
  recordedInTurn: number | null;
  disclosedAt: number | null;
  status: BeliefStatus;
  note: string | null;
}

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface Decision {
  turnIndex: number;
  triggerSequence: number | null;
  at: string;
  tool: string;
  status: string;
  title: string;
  details: string[];
  changes: FieldChange[];
}

export interface PlanWeek {
  index: number;
  start: string;
  distanceMetres: number;
  longestMetres: number;
  durationSeconds: number;
  sessions: number;
}

export interface PlanFitness {
  weeks: PlanWeek[];
  baselineWeeklyMetres: number | null;
  baselineLongestMetres: number | null;
  sessionsPerWeek: number | null;
  availableWeekdays: number[];
  weekdayCounts: number[];
  /** Minutes per ISO weekday (1–7), parsed from the availability fact. */
  dayLimits: Record<string, number>;
  workouts: {
    id: string;
    date: string;
    weekday: number;
    title: string;
    durationSeconds: number | null;
    distanceMetres: number | null;
    zones: string[];
  }[];
  zoneCounts: Record<string, number>;
  findings: { code: string; severity: string; message: string }[];
}

export type LoadSport = 'run' | 'cycle' | 'swim' | 'strength' | 'other';
/**
 * How a workout's stress was estimated: from pace/power targets against threshold, from an RPE,
 * from a zone's usual intensity, from the coach's duration estimate, or not at all.
 */
export type LoadMethod =
  'targets' | 'rpe' | 'zone_default' | 'estimate' | 'not_counted' | 'unestimated';
export interface LoadAmount {
  seconds: number;
  metres: number;
  tss: number;
}
export interface LoadWorkout extends LoadAmount {
  id: string;
  date: string;
  title: string;
  sport: LoadSport;
  intensityFactor: number | null;
  method: LoadMethod;
  /** Seconds in each band, counted per effort rather than from the workout average. */
  intensity: LoadWeek['intensity'];
  /** Contributions from each effort's discipline, including mixed workouts. */
  sports: Partial<Record<LoadSport, LoadAmount>>;
}
export interface LoadDay {
  date: string;
  sports: Partial<Record<LoadSport, LoadAmount>>;
  seconds: number;
  metres: number;
  tss: number;
  /** 42-day weighted average of daily stress (CTL). */
  fitness: number;
  /** 7-day weighted average of daily stress (ATL). */
  fatigue: number;
  /** Fitness minus fatigue (TSB). */
  form: number;
}
export interface LoadWeek {
  index: number;
  start: string;
  sports: Partial<Record<LoadSport, LoadAmount>>;
  seconds: number;
  metres: number;
  tss: number;
  fitness: number;
  fatigue: number;
  form: number;
  /** Seconds by intensity factor: easy < 0.85, moderate < 0.95, hard ≥ 0.95. */
  intensity: { easy: number; moderate: number; hard: number; uncounted: number };
}
export interface PlanLoad {
  start: string;
  end: string;
  coverageEnd: string | null;
  events: { date: string; label: string }[];
  /** The athlete's stated training before the plan, which seeds fitness and fatigue. */
  baseline: {
    weeklyTss: number;
    weeklySeconds: number;
    weeklyMetres: number;
    assumption: string;
  } | null;
  thresholds: {
    runPaceSecondsPerKm: number | null;
    ftpWatts: number | null;
    cssSecondsPer100m: number | null;
  };
  days: LoadDay[];
  weeks: LoadWeek[];
  workouts: LoadWorkout[];
  methods: Partial<Record<LoadMethod, number>>;
}

export interface SummaryClaim {
  label: string;
  plannedKm: number;
  mentioned: boolean;
}

export interface PlannedWorkout {
  id: string;
  date: string;
  weekNumber: number | null;
  title: string;
  discipline: string;
  distanceMetres: number | null;
  durationSeconds: number | null;
  instructions: string | null;
}

export interface PlanBlock {
  title: string;
  phase: string | null;
  startDate: string;
  endDate: string;
  description: string | null;
}

export interface RunDetail extends RunSummary {
  reviewSummary: string | null;
  reviewVerdict: string | null;
  judgments: CriterionJudgment[];
  checkDetails: CheckOutcome[];
  messages: ConversationMessage[];
  turns: CoachTurn[];
  disclosures: Disclosure[];
  beliefs: BeliefRow[];
  decisions: Decision[];
  fitness: PlanFitness | null;
  load: PlanLoad | null;
  claims: SummaryClaim[];
  /** Exact prompt texts saved with the run, keyed by role. Older runs saved none. */
  prompts: PromptRecord[];
  highlights: Highlight[];
  progress: { at: string; stage: string }[];
  workouts: PlannedWorkout[];
  blocks: PlanBlock[];
  planStart: string | null;
  planEnd: string | null;
  facts: Record<string, string>;
  dates: Record<string, string>;
}

export interface PromptRecord {
  role: string;
  name: string | null;
  hash: string | null;
  text: string | null;
}

export interface CalibrationFixture {
  id: string;
  split: string;
  description: string;
  expectedVerdicts: string[];
  expectedCriteria: Record<string, string[]>;
}

export interface CalibrationJudgment {
  criterion: string;
  expected: string[];
  actual: string;
  matched: boolean;
  missedDefect: boolean;
  falseAlarm: boolean;
}

export interface CalibrationAttempt {
  fixtureId: string;
  repetition: number;
  status: string;
  elapsedMs: number | null;
  verdict: string | null;
  summary: string | null;
  criteria: CriterionJudgment[];
  verdictMatched: boolean | null;
  badPlanAccepted: boolean;
  judgments: CalibrationJudgment[];
  inputTokens: number;
  outputTokens: number;
}

export interface CriterionAgreement {
  criterion: string;
  labeled: number;
  matched: number;
  missedDefects: number;
  falseAlarms: number;
}

export interface CalibrationRun {
  id: string;
  startedAt: string;
  scripted: boolean;
  demo: boolean;
  reviewerModel: string | null;
  reviewerVersion: string | null;
  split: string;
  repeat: number;
  revision: string | null;
  workingTreeDirty: boolean;
  stage: string | null;
  requested: number;
  attempted: number;
  completed: number;
  errors: number;
  verdictMatches: number;
  badPlansAccepted: number;
  labeledJudgments: number;
  judgmentMatches: number;
  missedDefects: number;
  falseAlarms: number;
  criterionResults: CriterionAgreement[];
  stability: { fixtureId: string; consistency: string }[];
  fixtures: CalibrationFixture[];
  attempts: CalibrationAttempt[];
}

export interface ResultsIndex {
  root: string;
  generatedAt: string;
  runs: RunSummary[];
  calibrations: CalibrationRun[];
  skipped: { id: string; reason: string }[];
}

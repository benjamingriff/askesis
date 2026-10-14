import type {
  BeliefRow,
  CoachTurn,
  ConversationMessage,
  ConversationStats,
  Decision,
  Disclosure,
  FieldChange,
  PlanFitness,
  PlanLoad,
  PlanWeek,
  SessionFlag,
  SummaryClaim,
  ToolCall,
  TurnStep,
} from '../src/types';
import { asArray, asNumber, asString, isObject, objects, type Json } from './json';
import { buildLoad } from './load';
import { normalizeScenario, requiredFacts } from './scenario';

// Derives what happened in one benchmark conversation from its raw artifacts:
// coach turns joined to their tool calls, what the athlete disclosed and when,
// what the coach recorded about the athlete, and how the saved plan measures up
// against the scenario. Everything is a pure function of the files so it can be
// unit-tested against fixtures.

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NUDGE = 'Please go ahead and create';
const UNKNOWN = "I don't know anything else";

export interface SessionInput {
  messages: Json[];
  tools: Json[];
  snapshot: Json | null;
  disclosures: Json[];
  /** One row per simulated athlete message: selected facts, intent and voice attempts. */
  actions?: Json[];
  plan: Json | null;
  scenario: Json | null;
  metrics: Json | null;
  /** Benchmark stop reason; discovery flags are noise when a run stopped early. */
  stopReason?: string | null;
  /** False while a run has no assessment yet; its transcript is still growing. */
  finished?: boolean;
}

export interface Session {
  messages: ConversationMessage[];
  turns: CoachTurn[];
  disclosures: Disclosure[];
  beliefs: BeliefRow[];
  decisions: Decision[];
  fitness: PlanFitness | null;
  load: PlanLoad | null;
  claims: SummaryClaim[];
  stats: ConversationStats | null;
  flags: SessionFlag[];
}

// ---------- small helpers ----------

function time(value: unknown): number | null {
  const parsed = Date.parse(asString(value) ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function countQuestions(text: string): number {
  return (text.match(/\?(?=[\s*_)"'’”]|$)/g) ?? []).length;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function km(metres: number | null): string | null {
  if (metres === null) return null;
  return `${Number((metres / 1000).toFixed(1))} km`;
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function pace(secondsPerKm: number | null): string | null {
  return secondsPerKm === null ? null : `${clock(secondsPerKm)}/km`;
}

function isoWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Keeps large tool payloads (whole plan contexts) out of the response. */
function clip(value: unknown, max = 12_000): unknown {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  if (text === undefined || text.length <= max) return value ?? null;
  return { truncated: true, bytes: text.length, preview: `${text.slice(0, max)}…` };
}

// ---------- messages, disclosures, tools ----------

function toMessages(raw: Json[]): ConversationMessage[] {
  return raw
    .map((message) => ({
      sequence: asNumber(message.sequence) ?? 0,
      role: asString(message.role) ?? 'unknown',
      content: asString(message.content) ?? '',
      createdAt: asString(message.createdAt),
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

function toDisclosures(
  raw: Json[],
  messages: ConversationMessage[],
  actions: Json[],
): Disclosure[] {
  const recorded = new Map(
    raw.map((entry) => [
      asNumber(entry.sequence) ?? -1,
      asArray(entry.factIds).filter((id): id is string => typeof id === 'string'),
    ]),
  );
  const actionAt = new Map(actions.map((action) => [asNumber(action.sequence) ?? -1, action]));
  return messages
    .filter(
      (message) =>
        message.role === 'user' && (message.sequence > 1 || recorded.has(message.sequence)),
    )
    .map((message) => {
      const factIds = recorded.get(message.sequence) ?? [];
      const action = actionAt.get(message.sequence);
      const voice = isObject(action?.voice) ? action.voice : null;
      const status = asString(voice?.status);
      // Recorded intent is authoritative; older runs only show it through fixed phrases.
      const intent = asString(action?.intent);
      const kind: Disclosure['kind'] =
        intent === 'generate' || (!intent && message.content.includes(NUDGE))
          ? 'nudge'
          : intent === 'unknown' ||
              (!intent && message.content.includes(UNKNOWN)) ||
              factIds.length === 0
            ? 'unknown'
            : 'answer';
      return {
        sequence: message.sequence,
        factIds,
        kind,
        voice:
          voice && (status === 'voiced' || status === 'fallback' || status === 'skipped')
            ? {
                id: asString(voice.id) ?? 'voice',
                status,
                attempts: objects(voice.attempts).length,
                authored: asString(action?.authored),
              }
            : null,
      };
    });
}

export function toolKind(name: string): ToolCall['kind'] {
  return /^(read|preview|check)_/.test(name) ? 'read' : 'write';
}

/** Unclipped tool payloads by operation id. Analysis reads these; only the
 * copies returned to the browser are clipped. */
type RawPayloads = Map<string, { input: unknown; result: unknown }>;

function groupToolCalls(rows: Json[], raw: RawPayloads): (ToolCall & { runId: string | null })[] {
  const calls = new Map<string, { start: Json | null; end: Json | null }>();
  rows.forEach((row, index) => {
    const key = asString(row.operationId) ?? `row-${index}`;
    const entry = calls.get(key) ?? { start: null, end: null };
    if (row.status === 'started') entry.start = row;
    else entry.end = row;
    calls.set(key, entry);
  });
  return [...calls.entries()]
    .map(([operationId, { start, end }]) => {
      const source = end ?? start ?? {};
      const name = asString(source.name) ?? 'tool';
      const input = start?.input ?? null;
      const result =
        (isObject(end?.result) && 'result' in end.result ? end.result.result : end?.result) ?? null;
      return {
        operationId,
        runId: asString(source.runId),
        at: asString(end?.at) ?? asString(start?.at) ?? '',
        name,
        kind: toolKind(name),
        status: asString(end?.status) ?? 'started',
        elapsedMs: asNumber(end?.elapsedMs),
        summary: '',
        input: clip(input),
        result: clip(result),
        raw: { input, result },
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ raw: payload, ...call }) => {
      raw.set(call.operationId, payload);
      return {
        ...call,
        summary: summarizeTool(call.name, payload.input, payload.result, call.status),
      };
    });
}

function summarizeTool(name: string, input: unknown, result: unknown, status: string): string {
  const prefix = status === 'failed' ? 'Failed: ' : '';
  const body = isObject(input) ? input : {};
  const output = isObject(result) ? result : {};
  switch (name) {
    case 'create_plan_draft':
      return `${prefix}Created draft “${asString(body.displayName) ?? 'plan'}” ${asString(body.startDate) ?? '?'} → ${asString(body.endDate) ?? '?'}`;
    case 'update_plan_brief': {
      const brief = isObject(output.brief) ? output.brief : {};
      const edit = asNumber(brief.editNumber);
      return `${prefix}Updated brief${edit === null ? '' : ` (edit ${edit})`}`;
    }
    case 'apply_schedule_changes': {
      const count = (key: string) => asArray(body[key]).length;
      const parts = [
        `${count('blocks')} block${count('blocks') === 1 ? '' : 's'}`,
        `${count('weeks')} weeks`,
        `${count('workouts')} workouts`,
      ];
      const deleted = count('deleteWorkoutIds') + count('deleteWeekIds') + count('deleteBlockIds');
      if (deleted > 0) parts.push(`${deleted} deletions`);
      return `${prefix}Saved schedule: ${parts.join(', ')}`;
    }
    case 'validate_plan': {
      const findings = objects(output.findings);
      return `${prefix}Validated plan: ${findings.length === 0 ? 'no findings' : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}`;
    }
    case 'preview_performance':
    case 'record_performance': {
      const measured = isObject(body.input) ? body.input : {};
      const distance = asNumber(measured.distanceMetres);
      const duration = asNumber(measured.durationSeconds);
      const what =
        distance !== null && duration !== null ? ` from ${km(distance)} in ${clock(duration)}` : '';
      return `${prefix}${name === 'preview_performance' ? 'Previewed pace zones' : 'Recorded fitness evidence'}${what}`;
    }
    case 'retract_performance':
      return `${prefix}Retracted fitness evidence`;
    default: {
      const text = name.replace(/_/g, ' ');
      return `${prefix}${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    }
  }
}

// ---------- coach turns ----------

function buildTurns(
  input: SessionInput,
  messages: ConversationMessage[],
  tools: ReturnType<typeof groupToolCalls>,
): CoachTurn[] {
  const raw = input.messages;
  const snapshotRuns = objects(input.snapshot?.runs);
  const outputs = objects(input.snapshot?.outputs);
  const runs =
    snapshotRuns.length > 0
      ? snapshotRuns
      : objects(input.metrics?.coachUsage).map((usage): Json => ({
          id: usage.runId,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          status: 'completed',
        }));
  const users = messages.filter((message) => message.role === 'user');

  return runs
    .map((run) => ({ run, created: time(run.created_at) ?? 0 }))
    .sort((a, b) => a.created - b.created)
    .map(({ run }, index) => {
      const runId = asString(run.id) ?? `turn-${index}`;
      const output = outputs.find((entry) => entry.runId === runId);
      const timings = isObject(output?.timings) ? output.timings : {};
      const replyRaw = raw.find((message) => message.producingRunId === runId);
      const replySequence = asNumber(replyRaw?.sequence);
      const created = time(run.created_at);
      const trigger =
        replySequence !== null
          ? [...users].reverse().find((message) => message.sequence < replySequence)
          : [...users]
              .reverse()
              .find((message) => (time(message.createdAt) ?? 0) <= (created ?? Infinity));
      const reply =
        replySequence === null
          ? null
          : messages.find((message) => message.sequence === replySequence);
      const started = time(run.started_at);
      const finished = time(run.finished_at);
      const numbers = (key: string) =>
        asArray(timings[key]).filter((value): value is number => typeof value === 'number');
      const ownTools = tools
        .filter((tool) => tool.runId === runId)
        .map(({ runId: _runId, ...tool }) => tool);
      // Text the coach wrote before or between tool calls; the final segment is the reply.
      const segments = objects(output?.items)
        .filter((item) => item.isFinal !== true && (asString(item.content) ?? '').trim() !== '')
        .map((item) => ({
          itemId: asString(item.itemId) ?? '',
          position: asNumber(item.position) ?? 0,
          content: asString(item.content) ?? '',
          at: asString(item.startedAt),
        }));
      const ordered = segments.every((segment) => segment.at !== null);
      const steps: TurnStep[] = [
        ...segments.map((segment) => ({
          kind: 'text' as const,
          at: segment.at,
          position: segment.position,
          content: segment.content,
        })),
        ...ownTools.map((tool) => ({
          kind: 'tool' as const,
          at: tool.at || null,
          position: 0,
          operationId: tool.operationId,
        })),
      ].sort((a, b) =>
        ordered
          ? (a.at ?? '').localeCompare(b.at ?? '')
          : // Without saved times, text segments are shown first in position order.
            Number(a.kind === 'tool') - Number(b.kind === 'tool') || a.position - b.position,
      );
      return {
        index: index + 1,
        runId,
        triggerSequence: trigger?.sequence ?? null,
        replySequence,
        status: asString(run.status) ?? 'unknown',
        failureCode: asString(run.failure_code),
        createdAt: asString(run.created_at),
        startedAt: asString(run.started_at),
        finishedAt: asString(run.finished_at),
        durationMs:
          asNumber(timings.executionMs) ??
          (started !== null && finished !== null ? finished - started : null),
        queueWaitMs: asNumber(timings.queueWaitMs),
        firstVisibleMs: asNumber(timings.firstVisibleMs),
        modelMs: numbers('modelMs'),
        toolMs: numbers('toolMs'),
        inputTokens: asNumber(run.input_tokens) ?? 0,
        outputTokens: asNumber(run.output_tokens) ?? 0,
        questions: reply ? countQuestions(reply.content) : 0,
        words: reply ? words(reply.content) : 0,
        tools: ownTools,
        steps,
        stepsOrdered: ordered,
      };
    });
}

// ---------- beliefs: what the coach recorded vs what the athlete said ----------

interface BriefEdit {
  turn: number;
  brief: Json;
}

function runSport(brief: Json): Json {
  return (
    objects(brief.sports).find((sport) => sport.sport === 'run') ?? objects(brief.sports)[0] ?? {}
  );
}

function known(field: unknown): number | null {
  if (typeof field === 'number') return field;
  if (!isObject(field) || field.status !== 'known') return null;
  return asNumber(field.value);
}

function weekdaysOf(brief: Json): string | null {
  const values = asArray(brief.weekdays);
  if (values.length !== 7) return null;
  const days = values
    .map((value, index) =>
      value === 'available' || value === 'preferred' ? WEEKDAY_NAMES[index] : null,
    )
    .filter((day): day is string => day !== null);
  return days.length > 0 ? days.join(', ') : null;
}

function firstStableTurn<T>(
  series: { turn: number; value: T | null }[],
  final: T | null,
): number | null {
  if (final === null) return null;
  let turn: number | null = null;
  for (const entry of series) {
    if (entry.value === final) turn ??= entry.turn;
    else turn = null;
  }
  return turn;
}

function buildBeliefs(
  input: SessionInput,
  turns: CoachTurn[],
  disclosures: Disclosure[],
  tools: ToolCall[],
  toolTurn: Map<string, number>,
  raw: RawPayloads,
): BeliefRow[] {
  const inputOf = (tool: ToolCall | undefined): Json => {
    const value = tool ? raw.get(tool.operationId)?.input : undefined;
    return isObject(value) ? value : {};
  };
  const scenario = input.scenario ?? {};
  const expectations = isObject(scenario.expectations) ? scenario.expectations : {};
  const dates = isObject(scenario.dates) ? scenario.dates : {};
  const facts = isObject(scenario.facts) ? scenario.facts : {};
  const plan = input.plan;
  const finalBrief = isObject(plan?.brief) && isObject(plan.brief.brief) ? plan.brief.brief : null;

  const edits: BriefEdit[] = tools
    .filter((tool) => tool.name === 'update_plan_brief' && tool.status === 'completed')
    .flatMap((tool) => {
      const body = inputOf(tool);
      return isObject(body.brief)
        ? [{ turn: toolTurn.get(tool.operationId) ?? 0, brief: body.brief }]
        : [];
    });
  const lastBrief = finalBrief ?? edits[edits.length - 1]?.brief ?? null;

  const disclosedAt = (factId: string) =>
    disclosures.find((entry) => entry.factIds.includes(factId))?.sequence ?? null;
  const triggerOf = (turn: number | null) =>
    turn === null ? null : (turns.find((entry) => entry.index === turn)?.triggerSequence ?? null);

  const row = (
    field: string,
    label: string,
    factId: string,
    expected: string | null,
    recorded: string | null,
    recordedInTurn: number | null,
    note: string | null = null,
  ): BeliefRow => {
    const disclosed = disclosedAt(factId);
    const trigger = triggerOf(recordedInTurn);
    const status: BeliefRow['status'] =
      recorded === null
        ? 'missing'
        : expected !== null && recorded !== expected
          ? 'mismatch'
          : disclosed === null || (trigger ?? Infinity) < disclosed
            ? 'assumed'
            : expected === null
              ? 'review'
              : 'match';
    return {
      field,
      label,
      factId,
      expected,
      recorded,
      recordedInTurn,
      disclosedAt: disclosed,
      status,
      note,
    };
  };

  const fromBrief = (read: (brief: Json) => string | null) => {
    const final = lastBrief ? read(lastBrief) : null;
    const series = edits.map((edit) => ({ turn: edit.turn, value: read(edit.brief) }));
    return { final, turn: firstStableTurn(series, final) };
  };

  const rows: BeliefRow[] = [];

  // Plan dates are set by create_plan_draft and may be changed by any brief
  // update, so attribute them to the turn in which the final dates stabilised.
  const header = isObject(plan?.header) && isObject(plan.header.draft) ? plan.header.draft : null;
  const dateSeries: { turn: number; value: string | null }[] = [];
  let latestDates: string | null = null;
  for (const tool of tools) {
    if (tool.status !== 'completed') continue;
    if (tool.name !== 'create_plan_draft' && tool.name !== 'update_plan_brief') continue;
    const body = inputOf(tool);
    // A brief update that omits both dates leaves them unchanged.
    if (tool.name === 'update_plan_brief' && !('startDate' in body) && !('endDate' in body))
      continue;
    const startDate = asString(body.startDate);
    const endDate = asString(body.endDate);
    latestDates = startDate && endDate ? `${startDate} → ${endDate}` : null;
    dateSeries.push({ turn: toolTurn.get(tool.operationId) ?? 0, value: latestDates });
  }
  const savedStart = asString(header?.startDate);
  const savedEnd = asString(header?.endDate);
  const finalDates = savedStart && savedEnd ? `${savedStart} → ${savedEnd}` : latestDates;
  const expectedStart = asString(dates.startDate);
  const expectedEnd = asString(dates.eventDate);
  rows.push(
    row(
      'dates',
      'Plan dates',
      'dates',
      expectedStart && expectedEnd ? `${expectedStart} → ${expectedEnd}` : null,
      finalDates,
      firstStableTurn(dateSeries, finalDates),
    ),
  );

  const sessionsPerWeek = asNumber(expectations.sessionsPerWeek);
  const current = fromBrief((brief) => {
    const value = known(runSport(brief).currentSessions);
    return value === null ? null : `${value} runs`;
  });
  // The benchmark's baseline check expects three current runs per week.
  rows.push(
    row(
      'currentSessions',
      'Current runs per week',
      'training',
      '3 runs',
      current.final,
      current.turn,
    ),
  );

  const weekly = fromBrief((brief) => km(known(runSport(brief).weeklyDistance)));
  rows.push(
    row(
      'weeklyDistance',
      'Weekly distance',
      'training',
      km(asNumber(expectations.weeklyDistanceMetres)),
      weekly.final,
      weekly.turn,
    ),
  );

  const longest = fromBrief((brief) => km(known(runSport(brief).longestDistance)));
  rows.push(
    row(
      'longestDistance',
      'Longest recent run',
      'training',
      km(asNumber(expectations.longestDistanceMetres)),
      longest.final,
      longest.turn,
    ),
  );

  const desired = fromBrief((brief) => {
    const value = known(runSport(brief).desiredSessions);
    return value === null ? null : `${value} runs`;
  });
  rows.push(
    row(
      'desiredSessions',
      'Runs per week wanted',
      'frequency',
      sessionsPerWeek === null ? null : `${sessionsPerWeek} runs`,
      desired.final,
      desired.turn,
    ),
  );

  const availableDays = asArray(expectations.availableWeekdays).filter(
    (day): day is number => typeof day === 'number',
  );
  const weekdays = fromBrief(weekdaysOf);
  rows.push(
    row(
      'weekdays',
      'Available days',
      'availability',
      availableDays.length > 0
        ? availableDays
            .sort()
            .map((day) => WEEKDAY_NAMES[day - 1])
            .join(', ')
        : null,
      weekdays.final,
      weekdays.turn,
    ),
  );

  const constraints = asString(facts.constraints) ?? '';
  const expectedUnit = /kilomet/i.test(constraints)
    ? 'kilometres'
    : /\bmiles?\b/i.test(constraints)
      ? 'miles'
      : null;
  const unit = fromBrief((brief) => asString(brief.unit));
  rows.push(row('unit', 'Distance unit', 'constraints', expectedUnit, unit.final, unit.turn));

  const recordCall = [...tools]
    .reverse()
    .find((tool) => tool.name === 'record_performance' && tool.status === 'completed');
  const recordInput = inputOf(recordCall);
  const measured = isObject(recordInput.input) ? recordInput.input : {};
  const raceDistance = asNumber(expectations.raceDistanceMetres);
  const raceDuration = asNumber(expectations.raceDurationSeconds);
  const fitnessText = (
    distance: number | null,
    duration: number | null,
    observed: string | null,
  ) =>
    distance !== null && duration !== null
      ? `${km(distance)} in ${clock(duration)}${observed ? ` on ${observed}` : ''}`
      : null;
  rows.push(
    row(
      'fitness',
      'Fitness evidence',
      'fitness',
      fitnessText(raceDistance, raceDuration, asString(dates.observedOn)),
      recordCall
        ? fitnessText(
            asNumber(measured.distanceMetres),
            asNumber(measured.durationSeconds),
            asString(recordInput.observedOn),
          )
        : null,
      recordCall ? (toolTurn.get(recordCall.operationId) ?? null) : null,
      asString(recordInput.provenance),
    ),
  );

  // Goal is free text, so it can only be flagged for review or as assumed.
  const goal = fromBrief((brief) => asString(brief.goal));
  const goalRow = row('goal', 'Goal', 'goal', null, goal.final, goal.turn, asString(facts.goal));
  // A goal restating the race and date is fine; outcome intent (completion,
  // finish time) the athlete never stated is an assumption.
  const intent = /complet|finish|comfortabl|target|personal best|\bPB\b/i.test(goal.final ?? '');
  rows.push(goalRow.status === 'assumed' && !intent ? { ...goalRow, status: 'review' } : goalRow);

  return rows;
}

// ---------- decisions ----------

function flattenBrief(brief: Json, top: Json): Record<string, string | null> {
  const sport = runSport(brief);
  const value = (field: unknown, format: (n: number) => string) => {
    if (isObject(field)) {
      if (field.status !== 'known') return asString(field.status);
      const number = asNumber(field.value);
      return number === null ? null : format(number);
    }
    const number = asNumber(field);
    return number === null ? null : format(number);
  };
  const preferred = asArray(brief.weekdays)
    .map((day, index) => (day === 'preferred' ? WEEKDAY_NAMES[index] : null))
    .filter(Boolean)
    .join(', ');
  return {
    Goal: asString(brief.goal),
    'Distance unit': asString(brief.unit),
    'Current runs/week': value(sport.currentSessions, (n) => `${n}`),
    'Runs/week wanted': value(sport.desiredSessions, (n) => `${n}`),
    'Weekly distance': value(sport.weeklyDistance, (n) => km(n) ?? ''),
    'Longest run': value(sport.longestDistance, (n) => km(n) ?? ''),
    'Available days': weekdaysOf(brief),
    'Preferred days': preferred || null,
    Context: asString(brief.context),
    Dates:
      asString(top.startDate) && asString(top.endDate)
        ? `${asString(top.startDate)} → ${asString(top.endDate)}`
        : null,
  };
}

function buildDecisions(turns: CoachTurn[], raw: RawPayloads): Decision[] {
  const decisions: Decision[] = [];
  let previous: Record<string, string | null> | null = null;
  for (const turn of turns) {
    for (const tool of turn.tools) {
      const payload = raw.get(tool.operationId);
      const body = isObject(payload?.input) ? payload.input : {};
      const output = isObject(payload?.result) ? payload.result : {};
      const details: string[] = [];
      let changes: FieldChange[] = [];
      if (tool.name === 'update_plan_brief' && isObject(body.brief)) {
        const current = flattenBrief(body.brief, body);
        changes = Object.entries(current)
          .filter(([field, after]) => (previous?.[field] ?? null) !== after)
          .map(([field, after]) => ({ field, before: previous?.[field] ?? null, after }));
        if (tool.status === 'completed') previous = current;
      }
      if (tool.name === 'apply_schedule_changes') {
        const coverage = isObject(body.coverage) ? body.coverage : null;
        if (coverage)
          details.push(
            `Coverage ${asString(coverage.startDate) ?? '?'} → ${asString(coverage.endDate) ?? '?'}`,
          );
        for (const finding of objects(output.findings))
          details.push(`${asString(finding.severity)}: ${asString(finding.message)}`);
      }
      if (tool.name === 'validate_plan') {
        for (const finding of objects(output.findings))
          details.push(`${asString(finding.severity)}: ${asString(finding.message)}`);
      }
      if (tool.name === 'record_performance') {
        const basis = asString(body.estimateBasis);
        if (basis) details.push(basis);
        details.push(
          `Provenance ${asString(body.provenance) ?? 'unknown'}, observed ${asString(body.observedOn) ?? 'unknown'}`,
        );
      }
      if (tool.name === 'preview_performance') {
        const preview = isObject(output.preview) ? output.preview : {};
        const easy = objects(preview.zones).find((zone) => zone.key === 'easy');
        if (easy)
          details.push(`Easy zone ${pace(asNumber(easy.minimum))}–${pace(asNumber(easy.maximum))}`);
      }
      decisions.push({
        turnIndex: turn.index,
        triggerSequence: turn.triggerSequence,
        at: tool.at,
        tool: tool.name,
        status: tool.status,
        title: tool.summary,
        details,
        changes,
      });
    }
  }
  return decisions;
}

// ---------- plan fitness ----------

/** "up to 60 minutes on Tuesdays and Thursdays and up to 100 minutes on Sundays" */
export function parseDayLimits(text: string): Record<string, number> {
  const limits: Record<string, number> = {};
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const match of text.matchAll(/up to (\d+) minutes on ((?:(?!up to)[^.;])+)/gi)) {
    const minutes = Number(match[1]);
    const span = (match[2] ?? '').toLowerCase();
    days.forEach((day, index) => {
      if (span.includes(day)) limits[String(index + 1)] = minutes;
    });
  }
  return limits;
}

function zonesOf(step: unknown): string[] {
  if (!isObject(step)) return [];
  const own = objects(step.targets)
    .map((target) => asString(target.zoneKey))
    .filter((key): key is string => key !== null);
  return [...own, ...asArray(step.steps).flatMap(zonesOf)];
}

function buildFitness(input: SessionInput): PlanFitness | null {
  const plan = input.plan;
  if (!plan) return null;
  const scenario = input.scenario ?? {};
  const expectations = isObject(scenario.expectations) ? scenario.expectations : {};
  const facts = isObject(scenario.facts) ? scenario.facts : {};
  const workouts = objects(plan.workouts)
    .map((entry) => {
      const workout = isObject(entry.workout) ? entry.workout : {};
      const date = asString(workout.scheduledDate) ?? '';
      return {
        id: asString(workout.id) ?? '',
        date,
        weekday: date ? isoWeekday(date) : 0,
        title: asString(workout.title) ?? 'Workout',
        durationSeconds: asNumber(workout.estimatedDurationSeconds),
        distanceMetres: asNumber(workout.estimatedDistanceMetres),
        zones: [...new Set(zonesOf(entry.prescription))],
      };
    })
    .filter((workout) => workout.date !== '')
    .sort((a, b) => a.date.localeCompare(b.date));

  const weeks: PlanWeek[] = [];
  const first =
    asString(isObject(scenario.dates) ? scenario.dates.startDate : null) ?? workouts[0]?.date;
  if (first && workouts.length > 0) {
    const last = workouts[workouts.length - 1]?.date ?? first;
    for (
      let start = mondayOf(first), index = 1;
      start <= last;
      start = addDays(start, 7), index += 1
    ) {
      const end = addDays(start, 6);
      const own = workouts.filter((workout) => workout.date >= start && workout.date <= end);
      weeks.push({
        index,
        start,
        distanceMetres: own.reduce((sum, workout) => sum + (workout.distanceMetres ?? 0), 0),
        longestMetres: Math.max(0, ...own.map((workout) => workout.distanceMetres ?? 0)),
        durationSeconds: own.reduce((sum, workout) => sum + (workout.durationSeconds ?? 0), 0),
        sessions: own.length,
      });
    }
  }

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  const zoneCounts: Record<string, number> = {};
  for (const workout of workouts) {
    weekdayCounts[workout.weekday - 1] = (weekdayCounts[workout.weekday - 1] ?? 0) + 1;
    for (const zone of workout.zones) zoneCounts[zone] = (zoneCounts[zone] ?? 0) + 1;
  }

  return {
    weeks,
    baselineWeeklyMetres: asNumber(expectations.weeklyDistanceMetres),
    baselineLongestMetres: asNumber(expectations.longestDistanceMetres),
    sessionsPerWeek: asNumber(expectations.sessionsPerWeek),
    availableWeekdays: asArray(expectations.availableWeekdays).filter(
      (day): day is number => typeof day === 'number',
    ),
    weekdayCounts,
    dayLimits: isObject(expectations.dayLimits)
      ? Object.fromEntries(
          Object.entries(expectations.dayLimits).filter(
            (entry): entry is [string, number] => typeof entry[1] === 'number',
          ),
        )
      : parseDayLimits(asString(facts.availability) ?? ''),
    workouts,
    zoneCounts,
    findings: objects(plan.findings).map((finding) => ({
      code: asString(finding.code) ?? '',
      severity: asString(finding.severity) ?? 'info',
      message: asString(finding.message) ?? '',
    })),
  };
}

/** Does the coach's closing message mention the weekly figures it actually saved? */
function buildClaims(messages: ConversationMessage[], fitness: PlanFitness | null): SummaryClaim[] {
  if (!fitness || fitness.weeks.length === 0) return [];
  const final = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!final) return [];
  const mentioned = new Set(
    [...final.content.matchAll(/(\d+(?:\.\d+)?)\s*km\b/gi)].map((match) => Number(match[1])),
  );
  if (mentioned.size === 0) return [];
  return fitness.weeks.flatMap((week) => {
    const total = Number((week.distanceMetres / 1000).toFixed(1));
    const longest = Number((week.longestMetres / 1000).toFixed(1));
    return [
      { label: `Week ${week.index} total`, plannedKm: total, mentioned: mentioned.has(total) },
      {
        label: `Week ${week.index} long run`,
        plannedKm: longest,
        mentioned: mentioned.has(longest),
      },
    ];
  });
}

// ---------- flags & stats ----------

function buildFlags(
  messages: ConversationMessage[],
  turns: CoachTurn[],
  disclosures: Disclosure[],
  beliefs: BeliefRow[],
  fitness: PlanFitness | null,
  claims: SummaryClaim[],
  factsAvailable: string[],
  required: string[],
  stoppedEarly: boolean,
): SessionFlag[] {
  const flags: SessionFlag[] = [];
  const add = (
    kind: string,
    kindLabel: string,
    severity: SessionFlag['severity'],
    label: string,
    detail: string,
    ref: string | null,
    suffix = '',
  ) =>
    flags.push({
      id: suffix ? `${kind}:${suffix}` : kind,
      kind,
      kindLabel,
      severity,
      label,
      detail,
      ref,
    });
  const disclosed = new Set(disclosures.flatMap((entry) => entry.factIds));

  // When execution stopped early, missing facts and fields are symptoms of the
  // stop, which is reported on its own; listing them would bury the cause.
  for (const fact of stoppedEarly ? [] : required) {
    if (factsAvailable.includes(fact) && !disclosed.has(fact)) {
      add(
        `undisclosed:${fact}`,
        `Never learned ${fact}`,
        'critical',
        `Never learned ${fact}`,
        `The athlete never disclosed the required “${fact}” fact.`,
        null,
      );
    }
  }
  for (const belief of beliefs) {
    if (belief.status === 'mismatch') {
      add(
        `mismatch:${belief.field}`,
        `${belief.label} recorded wrongly`,
        'critical',
        `${belief.label} recorded wrongly`,
        `Recorded “${belief.recorded}”; the athlete said “${belief.expected}”.`,
        `belief:${belief.field}`,
      );
    } else if (belief.status === 'assumed') {
      add(
        `assumed:${belief.field}`,
        `${belief.label} assumed`,
        // A right guess recorded early is worth knowing; an unverifiable one matters more.
        belief.expected === null ? 'warning' : 'info',
        `${belief.label} assumed`,
        belief.disclosedAt === null
          ? `Recorded “${truncate(belief.recorded)}” although the athlete never stated it.`
          : `Recorded in turn ${belief.recordedInTurn}, before the athlete stated it at message ${belief.disclosedAt}.`,
        `belief:${belief.field}`,
      );
    } else if (belief.status === 'missing' && belief.expected !== null && !stoppedEarly) {
      add(
        `missing:${belief.field}`,
        `${belief.label} not recorded`,
        'warning',
        `${belief.label} not recorded`,
        `Expected “${belief.expected}” in the saved plan.`,
        `belief:${belief.field}`,
      );
    }
  }
  for (const entry of disclosures) {
    if (entry.kind === 'nudge') {
      add(
        'nudge',
        'Athlete had to ask for the plan',
        'warning',
        'Athlete had to ask for the plan',
        'The simulated athlete prompted the coach to go ahead and create the plan.',
        `message:${entry.sequence}`,
        String(entry.sequence),
      );
    }
    if (entry.kind === 'unknown') {
      add(
        'unanswerable',
        'Asked an unanswerable question',
        'info',
        'Unanswerable question',
        'The coach asked for something the athlete could not answer.',
        `message:${entry.sequence - 1}`,
        String(entry.sequence),
      );
    }
  }
  for (const turn of turns) {
    if (turn.questions > 1 && turn.replySequence !== null) {
      add(
        'multi-question',
        'Several questions in one message',
        'info',
        `${turn.questions} questions in one message`,
        'Several questions in one reply make it harder for the athlete to answer completely.',
        `message:${turn.replySequence}`,
        String(turn.index),
      );
    }
    for (const tool of turn.tools) {
      if (tool.status === 'failed') {
        add(
          'tool-failed',
          'Tool call failed',
          'warning',
          `${tool.name} failed`,
          `Tool call failed in turn ${turn.index}.`,
          `turn:${turn.index}`,
          tool.operationId,
        );
      }
    }
    if (turn.status !== 'completed') {
      add(
        'turn-failed',
        'Coach turn did not complete',
        'critical',
        `Turn ${turn.index} ${turn.status}`,
        turn.failureCode ?? 'The coach run did not complete.',
        `turn:${turn.index}`,
        String(turn.index),
      );
    }
  }
  if (fitness) {
    for (const workout of fitness.workouts) {
      if (
        fitness.availableWeekdays.length > 0 &&
        !fitness.availableWeekdays.includes(workout.weekday)
      ) {
        add(
          'unavailable-day',
          'Workout on an unavailable day',
          'critical',
          'Workout on unavailable day',
          `${workout.title} on ${WEEKDAY_NAMES[workout.weekday - 1]} ${workout.date}.`,
          `workout:${workout.id}`,
          workout.id,
        );
      }
      const limit = fitness.dayLimits[String(workout.weekday)];
      if (
        limit !== undefined &&
        workout.durationSeconds !== null &&
        workout.durationSeconds / 60 > limit
      ) {
        add(
          'over-limit',
          'Over the daily time limit',
          'warning',
          'Over the daily time limit',
          `${workout.title} is ${Math.round(workout.durationSeconds / 60)} min; ${WEEKDAY_NAMES[workout.weekday - 1]} allows ${limit} min.`,
          `workout:${workout.id}`,
          workout.id,
        );
      }
    }
    let previousWeekly = fitness.baselineWeeklyMetres;
    let previousLongest = fitness.baselineLongestMetres;
    for (const week of fitness.weeks) {
      if (previousWeekly && week.distanceMetres > previousWeekly * 1.1) {
        add(
          'volume-jump',
          'Weekly volume up more than 10%',
          'warning',
          `Week ${week.index} volume jump`,
          `${km(week.distanceMetres)} after ${km(previousWeekly)} (+${Math.round((week.distanceMetres / previousWeekly - 1) * 100)}%).`,
          'section:plan',
          String(week.index),
        );
      }
      if (previousLongest && week.longestMetres > previousLongest * 1.2) {
        add(
          'long-run-jump',
          'Long run up more than 20%',
          'warning',
          `Week ${week.index} long-run jump`,
          `${km(week.longestMetres)} after ${km(previousLongest)}.`,
          'section:plan',
          String(week.index),
        );
      }
      if (week.distanceMetres > 0) previousWeekly = week.distanceMetres;
      if (week.longestMetres > 0)
        previousLongest = Math.max(previousLongest ?? 0, week.longestMetres);
    }
  }
  const unmentioned = claims.filter((claim) => !claim.mentioned && claim.label.endsWith('total'));
  if (unmentioned.length > 0) {
    const last = [...messages].reverse().find((message) => message.role === 'assistant');
    add(
      'summary-omits',
      'Summary omits saved totals',
      'info',
      'Summary omits saved totals',
      `The closing message does not mention ${unmentioned.map((claim) => `${claim.label.toLowerCase()} (${claim.plannedKm} km)`).join(', ')}.`,
      last ? `message:${last.sequence}` : null,
    );
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

function truncate(text: string | null, max = 80): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function analyzeSession(source: SessionInput): Session {
  const input = { ...source, scenario: normalizeScenario(source.scenario) };
  const messages = toMessages(input.messages);
  const disclosures = toDisclosures(input.disclosures, messages, input.actions ?? []);
  const required = requiredFacts(input.scenario);
  const raw: RawPayloads = new Map();
  const tools = groupToolCalls(input.tools, raw);
  const turns = buildTurns(input, messages, tools);
  const toolTurn = new Map(
    turns.flatMap((turn) => turn.tools.map((tool) => [tool.operationId, turn.index] as const)),
  );
  const allTools = turns.flatMap((turn) => turn.tools);
  const beliefs = buildBeliefs(input, turns, disclosures, allTools, toolTurn, raw);
  const decisions = buildDecisions(turns, raw);
  const fitness = buildFitness(input);
  const claims = buildClaims(messages, fitness);
  const facts = isObject(input.scenario?.facts) ? Object.keys(input.scenario.facts) : [];
  const stoppedEarly =
    input.finished === false ||
    (input.stopReason !== undefined &&
      input.stopReason !== null &&
      input.stopReason !== 'completed') ||
    turns.some((turn) => turn.status !== 'completed');
  const flags = buildFlags(
    messages,
    turns,
    disclosures,
    beliefs,
    fitness,
    claims,
    facts,
    required,
    stoppedEarly,
  );

  const users = messages.filter((message) => message.role === 'user');
  const disclosedAll = disclosures.flatMap((entry) => entry.factIds);
  const planCall = allTools.find(
    (tool) => tool.name === 'apply_schedule_changes' && tool.status === 'completed',
  );
  const planTurn = planCall
    ? turns.find((turn) => turn.index === toolTurn.get(planCall.operationId))
    : undefined;
  const start = time(messages[0]?.createdAt);
  const durations = turns
    .map((turn) => turn.durationMs)
    .filter((value): value is number => value !== null);
  const firstVisible = turns
    .map((turn) => turn.firstVisibleMs)
    .filter((value): value is number => value !== null);

  const stats: ConversationStats | null =
    messages.length === 0
      ? null
      : {
          athleteTurns: users.length,
          coachTurns: turns.length,
          questions: turns.reduce((sum, turn) => sum + turn.questions, 0),
          maxQuestionsPerTurn: Math.max(0, ...turns.map((turn) => turn.questions)),
          multiQuestionTurns: turns.filter((turn) => turn.questions > 1).length,
          unanswerable: disclosures.filter((entry) => entry.kind === 'unknown').length,
          nudges: disclosures.filter((entry) => entry.kind === 'nudge').length,
          factsDisclosed: [...new Set(disclosedAll)],
          factsAvailable: facts,
          requiredFacts: required.filter((fact) => facts.length === 0 || facts.includes(fact)),
          repeatedFacts: disclosedAll.length - new Set(disclosedAll).size,
          turnsToPlan:
            planTurn?.triggerSequence === undefined || planTurn.triggerSequence === null
              ? null
              : users.filter((message) => message.sequence <= (planTurn.triggerSequence ?? 0))
                  .length,
          timeToPlanMs: planCall && start !== null ? (time(planCall.at) ?? start) - start : null,
          briefEdits: allTools.filter(
            (tool) => tool.name === 'update_plan_brief' && tool.status === 'completed',
          ).length,
          scheduleWrites: allTools.filter(
            (tool) => tool.name === 'apply_schedule_changes' && tool.status === 'completed',
          ).length,
          validations: allTools.filter((tool) => tool.name === 'validate_plan').length,
          lookups: allTools.filter((tool) => tool.kind === 'read').length,
          beliefMismatches: beliefs.filter(
            (belief) =>
              belief.status === 'mismatch' ||
              (belief.status === 'missing' && belief.expected !== null),
          ).length,
          assumptions: beliefs.filter((belief) => belief.status === 'assumed').length,
          medianTurnMs: median(durations),
          maxTurnMs: durations.length > 0 ? Math.max(...durations) : null,
          medianFirstVisibleMs: median(firstVisible),
          coachWords: turns.reduce((sum, turn) => sum + turn.words, 0),
        };

  const performance = isObject(input.snapshot?.performance) ? input.snapshot.performance : null;
  const load = buildLoad(input.plan, performance, input.scenario);
  return {
    messages,
    turns,
    disclosures,
    beliefs,
    decisions,
    fitness,
    load,
    claims,
    stats,
    flags,
  };
}

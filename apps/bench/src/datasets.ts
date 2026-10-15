import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const version = z.number().int().positive();
const ref = z.object({ id, version }).strict();
const category = z.enum([
  'running',
  'cycling',
  'triathlon',
  'swimming',
  'strength',
  'gym',
  'hybrid',
]);
const experience = z.enum(['beginner', 'improver', 'intermediate', 'experienced']);
const strings = z.array(z.string().min(1));
const positive = z.number().positive();
const sessions = z.number().int().min(0).max(14).nullable();
const baseline = {
  experience,
  historyYears: z.number().nonnegative(),
  recentBaselineWeeks: z.number().int().positive(),
  currentSessions: sessions,
  desiredSessions: z.number().int().min(1).max(14),
};
const distance = {
  weeklyDistanceMetres: z.number().nonnegative().nullable(),
  longestDistanceMetres: z.number().nonnegative().nullable(),
};
const sport = z.discriminatedUnion('sport', [
  z.object({ sport: z.literal('run'), ...baseline, ...distance }).strict(),
  z
    .object({
      sport: z.literal('swim'),
      ...baseline,
      ...distance,
      comfortableContinuousDistanceMetres: z.number().nonnegative().nullable().optional(),
    })
    .strict(),
  z
    .object({
      sport: z.literal('cycle'),
      ...baseline,
      weeklyDurationSeconds: z.number().nonnegative().nullable(),
      longestDurationSeconds: z.number().nonnegative().nullable(),
    })
    .strict(),
  z.object({ sport: z.literal('strength'), ...baseline }).strict(),
]);
// These authoring schemas deliberately cover the pilot evidence methods only.
const evidence = z.discriminatedUnion('system', [
  z
    .object({
      system: z.literal('run_pace'),
      input: z
        .object({
          method: z.literal('race_result'),
          distanceMetres: z.number().min(1609.344).max(42195),
          durationSeconds: z.number().int().positive(),
        })
        .strict(),
      observedDaysAgo: z.number().int().nonnegative(),
      provenance: z.literal('user_supplied'),
    })
    .strict(),
  z
    .object({
      system: z.literal('cycle_power'),
      input: z.object({ method: z.literal('ftp'), watts: positive.max(2000) }).strict(),
      observedDaysAgo: z.number().int().nonnegative(),
      provenance: z.literal('user_supplied'),
    })
    .strict(),
  z
    .object({
      system: z.literal('swim_pace'),
      input: z
        .object({
          method: z.literal('css_test'),
          t400Seconds: positive.max(3600),
          t200Seconds: positive.max(1800),
        })
        .strict()
        .refine(
          (v) => v.t400Seconds > 2 * v.t200Seconds,
          'CSS test must yield a plausible positive threshold pace.',
        ),
      observedDaysAgo: z.number().int().nonnegative(),
      provenance: z.literal('user_supplied'),
    })
    .strict(),
]);
export const PersonaSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version,
    category,
    experience,
    label: z.string().min(1),
    reviewStatus: z.literal('exploratory'),
    age: z.number().int().min(18).max(100),
    timezone: z.literal('Europe/London'),
    communication: z
      .object({
        style: z.string().min(1),
        disclosurePolicy: z.literal('answer_requested_facts'),
        unknownResponse: z.string().min(1),
      })
      .strict(),
    sports: z.array(sport).min(1).max(4),
    availability: z
      .array(
        z
          .object({
            weekday: z.number().int().min(1).max(7),
            maxMinutes: positive.max(1440),
            preferred: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(7),
    accessRestrictions: z.array(
      z
        .object({
          sport: z.enum(['run', 'cycle', 'swim', 'strength']),
          facility: z.string().min(1),
          weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
          maxMinutes: positive.max(1440),
        })
        .strict(),
    ),
    equipment: strings.min(1),
    constraints: strings.min(1),
    preferences: strings.min(1),
    performanceEvidence: z.array(evidence).max(3),
    factTemplates: z.record(id, z.string().min(1)),
  })
  .strict();
const criteria = [
  'goal_fit',
  'progression',
  'recovery',
  'prescriptions',
  'personalization',
  'conversation',
] as const;
export const DatasetScenarioSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version,
    persona: ref,
    personaOverrides: PersonaSchema.pick({
      experience: true,
      age: true,
      communication: true,
      sports: true,
      availability: true,
      accessRestrictions: true,
      equipment: true,
      constraints: true,
      preferences: true,
      performanceEvidence: true,
      factTemplates: true,
    })
      .partial()
      .strict()
      .optional(),
    mode: z.literal('conversation_to_plan'),
    split: z.enum(['development', 'holdout']),
    reviewStatus: z.literal('exploratory'),
    goal: z.string().min(1),
    openingMessage: z.string().min(1),
    openingFactIds: strings,
    planSpanWeeks: z.number().int().min(1).max(156),
    prescriptionWeeks: z.number().int().min(1).max(156),
    startPolicy: z.literal('next_monday'),
    events: z.array(
      z
        .object({
          label: z.string().min(1),
          week: z.number().int().positive(),
          weekday: z.number().int().min(1).max(7),
          priority: z.enum(['A', 'B', 'C']),
        })
        .strict(),
    ),
    expectations: z
      .object({
        outcome: z.literal('saved_draft'),
        frequencyPolicy: z.enum(['workouts_per_sport', 'sport_exposures']),
        requiredDiscovery: strings.min(1),
        checks: strings.min(1),
        reviewAnchors: z
          .object(
            Object.fromEntries(criteria.map((key) => [key, z.string().min(1)])) as Record<
              (typeof criteria)[number],
              z.ZodString
            >,
          )
          .strict(),
      })
      .strict(),
    limits: z
      .object({
        maxAthleteMessages: z.number().int().min(1).max(25),
        maxElapsedMinutes: z.number().int().min(1).max(60),
      })
      .strict(),
    legacyScenarioId: z.literal('running-poc').optional(),
  })
  .strict();
export const SuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version,
    label: z.string().min(1),
    scenarios: z.array(ref).min(1),
    coachPrompt: z.literal('current_production'),
    evaluationPolicy: z.literal('fixed_simulator_and_reviewer_required'),
  })
  .strict();
const plannedItem = {
  id,
  label: z.string().min(1),
  status: z.enum(['planned', 'authored']),
  split: z.enum(['development', 'holdout']),
  category,
  experience,
  file: z
    .string()
    .regex(/^(personas|scenarios)\/[a-z0-9-]+\.json$/)
    .nullable(),
  version: version.nullable(),
};
export const CatalogueSchema = z
  .object({
    schemaVersion: z.literal(1),
    version,
    updatedOn: z.iso.date(),
    proposal: z.literal('../../../../docs/product/athlete-scenario-evaluation-proposal.md'),
    personas: z.array(z.object(plannedItem).strict()),
    scenarios: z.array(
      z
        .object({
          ...plannedItem,
          kind: z.enum(['core', 'variation', 'adaptation', 'duration']),
          proposalRef: z.string().min(1),
          familyId: id,
          runnerSupport: z.enum(['legacy_running_poc', 'needs_runner']),
        })
        .strict(),
    ),
    followOn: z.array(
      z.object({ id, label: z.string().min(1), status: z.literal('planned') }).strict(),
    ),
  })
  .strict();
export type Persona = z.infer<typeof PersonaSchema>;
export type DatasetScenario = z.infer<typeof DatasetScenarioSchema>;
export type Dataset = {
  personas: Persona[];
  scenarios: DatasetScenario[];
  suites: z.infer<typeof SuiteSchema>[];
  catalogue: z.infer<typeof CatalogueSchema>;
};
const datasetRoot = fileURLToPath(new URL('../datasets/v1/', import.meta.url));
const weekNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const systemSport = { run_pace: 'run', cycle_power: 'cycle', swim_pace: 'swim' } as const;
function unique(values: (string | number)[], context: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${context}.`);
}
function datePlus(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function render(template: string, values: Record<string, string>) {
  const result = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown fact placeholder: ${key}.`);
    return values[key]!;
  });
  if (result.includes('{{') || result.includes('}}'))
    throw new Error('Malformed fact placeholder.');
  return result;
}
export function resolveDatasetScenario(persona: Persona, scenario: DatasetScenario, now: Date) {
  if (persona.id !== scenario.persona.id || persona.version !== scenario.persona.version)
    throw new Error(`Persona reference mismatch for ${scenario.id}.`);
  // Overrides replace complete typed fields; never deep-merge arrays or private facts.
  persona = PersonaSchema.parse({ ...persona, ...scenario.personaOverrides });
  validatePersona(persona);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: persona.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const startDate = datePlus(today, (8 - weekday) % 7 || 7);
  const dates = {
    today,
    startDate,
    endDate: datePlus(startDate, scenario.planSpanWeeks * 7 - 1),
    coverageEndDate: datePlus(startDate, scenario.prescriptionWeeks * 7 - 1),
  };
  const values: Record<string, string> = {
    ...dates,
    age: String(persona.age),
    planSpanWeeks: String(scenario.planSpanWeeks),
    prescriptionWeeks: String(scenario.prescriptionWeeks),
    equipment: persona.equipment.join('; '),
    constraints: persona.constraints.join('; '),
    preferences: persona.preferences.join('; '),
    facilityAccess: persona.accessRestrictions
      .map(
        (access) =>
          `${access.facility} for ${access.sport}, only ${access.weekdays.map((day) => weekNames[day - 1]).join(' and ')}, up to ${access.maxMinutes} minutes per visit`,
      )
      .join('; '),
    availability:
      persona.availability
        .map(
          (day) =>
            `${weekNames[day.weekday - 1]}: up to ${day.maxMinutes} minutes${day.preferred ? ' (preferred)' : ''}`,
        )
        .join('; ') + '. All other days are unavailable.',
  };
  const number = (value: number | null, divisor = 1) =>
    value === null ? 'unknown' : String(value / divisor);
  for (const baseline of persona.sports) {
    const prefix = baseline.sport;
    values[`${prefix}CurrentSessions`] = number(baseline.currentSessions);
    values[`${prefix}DesiredSessions`] = number(baseline.desiredSessions);
    values[`${prefix}BaselineWeeks`] = String(baseline.recentBaselineWeeks);
    if (baseline.sport === 'run' || baseline.sport === 'swim') {
      values[`${prefix}WeeklyMetres`] = number(baseline.weeklyDistanceMetres);
      values[`${prefix}LongestMetres`] = number(baseline.longestDistanceMetres);
      values[`${prefix}WeeklyKm`] = number(baseline.weeklyDistanceMetres, 1000);
      values[`${prefix}LongestKm`] = number(baseline.longestDistanceMetres, 1000);
      if (baseline.sport === 'swim' && baseline.comfortableContinuousDistanceMetres !== undefined)
        values.swimContinuousMetres = number(baseline.comfortableContinuousDistanceMetres);
    } else if (baseline.sport === 'cycle') {
      values.cycleWeeklyMinutes = number(baseline.weeklyDurationSeconds, 60);
      values.cycleLongestMinutes = number(baseline.longestDurationSeconds, 60);
    }
  }
  for (const evidence of persona.performanceEvidence) {
    const sport = systemSport[evidence.system];
    values[`${sport}ObservedOn`] = datePlus(today, -evidence.observedDaysAgo);
    if (evidence.system === 'run_pace') {
      values.runEvidenceKm = String(evidence.input.distanceMetres / 1000);
      values.runEvidenceMinutes = String(evidence.input.durationSeconds / 60);
    } else if (evidence.system === 'cycle_power')
      values.cycleEvidenceWatts = String(evidence.input.watts);
    else {
      values.swim400Seconds = String(evidence.input.t400Seconds);
      values.swim200Seconds = String(evidence.input.t200Seconds);
    }
  }
  const events = scenario.events.map((event) => ({
    ...event,
    date: datePlus(startDate, (event.week - 1) * 7 + event.weekday - 1),
  }));
  const facts: Record<string, string> = Object.fromEntries(
    Object.entries(persona.factTemplates).map(([key, template]) => [key, render(template, values)]),
  );
  facts.goal = render(scenario.goal, values);
  facts.dates =
    `Start on ${startDate}; the overall plan ends ${dates.endDate}. ` +
    (events.length
      ? events
          .map((event) => `${event.label}: ${event.date}, ${event.priority}-priority race.`)
          .join(' ')
      : 'There is no goal race or target event.');
  facts.horizon = `The overall plan is ${scenario.planSpanWeeks} weeks. Fully prescribe only the first ${scenario.prescriptionWeeks} weeks now, ${startDate} through ${dates.coverageEndDate}; later dates intentionally await feedback. Create an unlocked draft once you have enough information; I do not need to confirm a brief first.`;
  return {
    persona,
    scenario,
    dates,
    events,
    facts,
    openingMessage: render(scenario.openingMessage, values),
  };
}
function validatePersona(persona: Persona) {
  unique(
    persona.sports.map((sport) => sport.sport),
    `${persona.id} sport`,
  );
  unique(
    persona.availability.map((day) => day.weekday),
    `${persona.id} available day`,
  );
  unique(
    persona.performanceEvidence.map((item) => item.system),
    `${persona.id} performance system`,
  );
  for (const key of ['goal', 'dates', 'horizon'])
    if (Object.hasOwn(persona.factTemplates, key))
      throw new Error(`Scenario-owned fact ${key} in persona ${persona.id}.`);
  for (const access of persona.accessRestrictions) {
    unique(access.weekdays, `${persona.id} facility weekday`);
    if (!persona.sports.some((sport) => sport.sport === access.sport))
      throw new Error(`Untrained facility sport for ${persona.id}.`);
    for (const day of access.weekdays) {
      const available = persona.availability.find((slot) => slot.weekday === day);
      if (!available || access.maxMinutes > available.maxMinutes)
        throw new Error(`Facility access exceeds availability for ${persona.id}.`);
    }
  }
  const minimumWorkouts = Math.max(...persona.sports.map((sport) => sport.desiredSessions));
  if (minimumWorkouts > persona.availability.length * 2)
    throw new Error(`Infeasible frequency for ${persona.id}.`);
  for (const evidence of persona.performanceEvidence)
    if (!persona.sports.some((sport) => sport.sport === systemSport[evidence.system]))
      throw new Error(`Untrained performance system for ${persona.id}.`);
}
export function validateDataset(dataset: Dataset) {
  for (const [label, items] of [
    ['persona', dataset.personas],
    ['scenario', dataset.scenarios],
    ['suite', dataset.suites],
  ] as const)
    unique(
      items.map((item) => item.id),
      label,
    );
  unique(
    dataset.catalogue.personas.map((item) => item.id),
    'catalogue persona',
  );
  unique(
    dataset.catalogue.scenarios.map((item) => item.id),
    'catalogue scenario',
  );
  unique(
    dataset.catalogue.followOn.map((item) => item.id),
    'follow-on probe',
  );
  for (const persona of dataset.personas) validatePersona(persona);
  for (const scenario of dataset.scenarios) {
    const persona = dataset.personas.find((item) => item.id === scenario.persona.id);
    if (!persona) throw new Error(`Missing persona for ${scenario.id}.`);
    if (scenario.prescriptionWeeks > scenario.planSpanWeeks)
      throw new Error(`Prescription exceeds span for ${scenario.id}.`);
    if (scenario.events.some((event) => event.week > scenario.planSpanWeeks))
      throw new Error(`Event outside plan for ${scenario.id}.`);
    const resolved = resolveDatasetScenario(persona, scenario, new Date('2026-10-13T12:00:00Z'));
    unique(scenario.expectations.requiredDiscovery, `${scenario.id} required fact`);
    unique(scenario.expectations.checks, `${scenario.id} check`);
    unique(scenario.openingFactIds, `${scenario.id} opening fact`);
    for (const key of [...scenario.expectations.requiredDiscovery, ...scenario.openingFactIds])
      if (!Object.hasOwn(resolved.facts, key))
        throw new Error(`Missing fact ${key} for ${scenario.id}.`);
    if (
      scenario.legacyScenarioId &&
      (scenario.id !== 'running-poc' || persona.id !== 'running-poc')
    )
      throw new Error('Invalid legacy reference.');
    if (
      scenario.expectations.frequencyPolicy === 'workouts_per_sport' &&
      resolved.persona.sports.reduce((n, sport) => n + sport.desiredSessions, 0) >
        resolved.persona.availability.length * 2
    )
      throw new Error(`Infeasible workout frequency for ${scenario.id}.`);
  }
  for (const [kind, records] of [
    ['personas', dataset.personas],
    ['scenarios', dataset.scenarios],
  ] as const) {
    const inventory = dataset.catalogue[kind];
    for (const item of inventory) {
      const record = records.find((record) => record.id === item.id);
      if (item.status === 'authored') {
        if (
          !record ||
          item.version !== record.version ||
          item.file !== `${kind}/${item.id}.json` ||
          item.category !==
            (kind === 'personas'
              ? (record as Persona).category
              : dataset.personas.find((p) => p.id === (record as DatasetScenario).persona.id)
                  ?.category)
        )
          throw new Error(`Authored catalogue mismatch for ${item.id}.`);
      } else if (record || item.file !== null || item.version !== null)
        throw new Error(`Planned catalogue mismatch for ${item.id}.`);
    }
    for (const record of records)
      if (!inventory.some((item) => item.id === record.id && item.status === 'authored'))
        throw new Error(`Untracked ${kind} record ${record.id}.`);
  }
  for (const item of dataset.catalogue.scenarios) {
    const family = dataset.catalogue.personas.find((persona) => persona.id === item.familyId);
    if (!family || family.split !== item.split)
      throw new Error(`Family/split mismatch for ${item.id}.`);
    const scenario = dataset.scenarios.find((scenario) => scenario.id === item.id);
    if (scenario && (scenario.persona.id !== item.familyId || scenario.split !== item.split))
      throw new Error(`Scenario family/split mismatch for ${item.id}.`);
    if (
      item.runnerSupport === 'legacy_running_poc' &&
      (item.id !== 'running-poc' || item.status !== 'authored')
    )
      throw new Error(`Invalid runner support for ${item.id}.`);
  }
  for (const suite of dataset.suites) {
    unique(
      suite.scenarios.map((item) => item.id),
      `${suite.id} case`,
    );
    for (const ref of suite.scenarios) {
      const scenario = dataset.scenarios.find(
        (item) => item.id === ref.id && item.version === ref.version,
      );
      if (!scenario) throw new Error(`Missing suite scenario ${ref.id}@${ref.version}.`);
      if (dataset.catalogue.scenarios.find((item) => item.id === ref.id)?.split !== 'development')
        throw new Error(`Holdout in development suite ${suite.id}.`);
    }
  }
}
async function files<T>(root: string, directory: string, schema: z.ZodType<T>) {
  const names = (await readdir(resolve(root, directory)))
    .filter((name) => name.endsWith('.json'))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const data = schema.parse(JSON.parse(await readFile(resolve(root, directory, name), 'utf8')));
      if (name !== `${(data as { id: string }).id}.json`)
        throw new Error(`Filename/ID mismatch: ${directory}/${name}.`);
      return data;
    }),
  );
}
export async function loadDataset(root = datasetRoot): Promise<Dataset> {
  const [personas, scenarios, suites, catalogue] = await Promise.all([
    files(root, 'personas', PersonaSchema),
    files(root, 'scenarios', DatasetScenarioSchema),
    files(root, 'suites', SuiteSchema),
    readFile(resolve(root, 'catalogue.json'), 'utf8').then((value) =>
      CatalogueSchema.parse(JSON.parse(value)),
    ),
  ]);
  const dataset = { personas, scenarios, suites, catalogue };
  validateDataset(dataset);
  return dataset;
}
export function coverageMarkdown(dataset: Dataset) {
  const catalogue = dataset.catalogue;
  const count = (items: { status: string }[]) =>
    items.filter((item) => item.status === 'authored').length;
  const lines = [
    '# Athlete dataset coverage',
    '',
    `Generated from [catalogue.json](./v1/catalogue.json), catalogue v${catalogue.version}, updated ${catalogue.updatedOn}.`,
    '',
    `Personas: **${count(catalogue.personas)}/${catalogue.personas.length} authored**. Scenarios: **${count(catalogue.scenarios)}/${catalogue.scenarios.length} authored**.`,
    '',
    'Checked means the data file exists and passes authoring validation. It does not mean the case has been run, owner-reviewed or grading-calibrated. All authored datasets remain exploratory.',
    '',
    'Only `running-poc` is supported by the current benchmark runner. The other authored cases and the pilot suite need the general runner and sport-specific grading/dashboard work described in the proposal.',
    '',
    'Regenerate with `pnpm --filter @askesis/bench datasets:coverage:update`. Validate with `pnpm --filter @askesis/bench datasets:validate`.',
    '',
    '## Persona combinations',
    '',
  ];
  for (const sport of category.options) {
    lines.push(`### ${sport}`, '');
    for (const item of catalogue.personas.filter((item) => item.category === sport))
      lines.push(
        `- [${item.status === 'authored' ? 'x' : ' '}] ${item.file ? `[${item.id}](./v1/${item.file})` : `\`${item.id}\``} (${item.experience}, ${item.split}): ${item.label}`,
      );
    lines.push('');
  }
  for (const kind of ['core', 'variation', 'adaptation', 'duration'] as const) {
    lines.push(`## ${kind} scenarios`, '');
    for (const item of catalogue.scenarios.filter((item) => item.kind === kind))
      lines.push(
        `- [${item.status === 'authored' ? 'x' : ' '}] ${item.file ? `[${item.id}](./v1/${item.file})` : `\`${item.id}\``} (${item.proposalRef}, ${item.split}; family \`${item.familyId}\`): ${item.label}`,
      );
    lines.push('');
  }
  lines.push('## Follow-on execution probes', '');
  for (const item of catalogue.followOn) lines.push(`- [ ] \`${item.id}\`: ${item.label}`);
  lines.push(
    '',
    '## Remaining framework work',
    '',
    '- [ ] General runner support for the new scenario schema, zero/unknown baselines and explicit prescription horizons.',
    '- [ ] Per-sport checks, reviewer anchors and accurate dashboard quantities.',
    '- [ ] Sequential suite/model experiments with fixed simulator/reviewer models and isolated trial state.',
    '- [ ] Domain-clock consistency, adaptation checkpoints and full-horizon stress telemetry.',
    '- [ ] Owner review of all eight pilot outputs; calibrated training-quality anchors before quality gates.',
    '- [ ] At least one acceptable and one defective reviewer fixture per sport category; reuse reviewed running fixtures where suitable.',
    '',
    'Authoring order: finish the pilot runner, inspect the eight cases, then fill remaining core personas and reviewed variations. Reserved holdout families stay out of development suites.',
    '',
  );
  return lines.join('\n');
}
async function main() {
  const command = process.argv[2] ?? 'validate';
  if (!['validate', 'list', 'coverage', 'coverage:update'].includes(command))
    throw new Error('Use validate, list, coverage or coverage:update.');
  const dataset = await loadDataset();
  if (command === 'coverage:update') {
    await writeFile(resolve(datasetRoot, '../COVERAGE.md'), coverageMarkdown(dataset));
    console.log('Updated apps/bench/datasets/COVERAGE.md.');
  } else if (command === 'coverage') process.stdout.write(coverageMarkdown(dataset));
  else if (command === 'list') {
    for (const item of dataset.catalogue.scenarios)
      console.log(`${item.id}\t${item.status}\t${item.runnerSupport}\t${item.proposalRef}`);
  } else {
    const checksum = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
    console.log(
      `Valid: ${dataset.personas.length} personas, ${dataset.scenarios.length} scenarios, ${dataset.suites.length} suites; ${dataset.catalogue.scenarios.length} catalogue cases. SHA-256 ${checksum}`,
    );
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Dataset validation failed.');
    process.exitCode = 1;
  });

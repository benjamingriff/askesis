import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const ScenarioSchema = z
  .object({
    id: z.literal('running-poc'),
    version: z.number().int().positive(),
    timezone: z.literal('Europe/London'),
    openingMessage: z.string().min(1),
    facts: z.record(z.string(), z.string().min(1)),
    expectations: z
      .object({
        planningWeeks: z.number().int().min(1).max(12),
        goalWeeks: z.number().int().min(1).max(52),
        availableWeekdays: z.array(z.number().int().min(1).max(7)),
        sessionsPerWeek: z.number().int().min(1).max(7),
        weeklyDistanceMetres: z.number().positive(),
        longestDistanceMetres: z.number().positive(),
        raceDistanceMetres: z.number().positive(),
        raceDurationSeconds: z.number().int().positive(),
      })
      .strict(),
    limits: z
      .object({
        maxAthleteMessages: z.number().int().min(1).max(25),
        maxElapsedMinutes: z.number().int().min(1).max(60),
      })
      .strict(),
  })
  .strict();

export function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

export function resolveScenario(raw: unknown, now = new Date()) {
  const input = ScenarioSchema.parse(raw);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  // Always the next Monday, even when the run starts on Monday.
  const startDate = addDays(today, (8 - weekday) % 7 || 7);
  const dates = {
    today,
    startDate,
    eventDate: addDays(startDate, input.expectations.goalWeeks * 7 - 1),
    coverageEndDate: addDays(startDate, input.expectations.planningWeeks * 7 - 1),
    observedOn: addDays(today, -14),
  };
  const render = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = dates[key as keyof typeof dates];
      if (!value) throw new Error(`Unknown scenario date placeholder: ${key}`);
      return value;
    });
  return {
    ...input,
    openingMessage: render(input.openingMessage),
    facts: Object.fromEntries(
      Object.entries(input.facts).map(([key, value]) => [key, render(value)]),
    ),
    dates,
  };
}

export type Scenario = ReturnType<typeof resolveScenario>;

export async function loadScenario() {
  return resolveScenario(
    JSON.parse(await readFile(new URL('../scenarios/running-poc.json', import.meta.url), 'utf8')),
  );
}

export type AthleteAction = { factIds: string[]; intent: 'answer' | 'generate' | 'unknown' };

/** The model selects facts; only code renders their values into coach-visible messages. */
export function renderAthleteAction(scenario: Scenario, action: AthleteAction) {
  const ids = [...new Set(action.factIds)];
  for (const id of ids)
    if (!Object.hasOwn(scenario.facts, id)) throw new Error('Simulator selected an unknown fact.');
  const facts = ids.map((id) => scenario.facts[id]);
  if (action.intent === 'generate')
    facts.push('Please go ahead and create the agreed first four weeks of my plan.');
  if (action.intent === 'unknown' || !facts.length)
    facts.push(
      "I don't know anything else about that. Please use reasonable assumptions where appropriate.",
    );
  return { content: facts.join('\n'), factIds: ids };
}

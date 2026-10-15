import {
  loadDataset,
  loadVoices,
  resolveDatasetScenario,
  type DatasetScenario,
  type Persona,
} from './datasets.js';

export function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

/** How the simulated athlete words its replies; null keeps the authored fact text verbatim. */
export type ScenarioVoice = {
  id: string;
  version: number;
  label: string;
  description: string;
  traits: string[];
  examples: string[];
};

/**
 * A resolved dataset case. It is saved with each run and holds simulator-private facts and
 * evaluator-private expectations, so it must never be sent to the coach.
 */
export function buildScenario(
  persona: Persona,
  scenario: DatasetScenario,
  now: Date,
  voice: ScenarioVoice | null,
) {
  const resolved = resolveDatasetScenario(persona, scenario, now);
  return {
    edition: 'v1' as const,
    id: scenario.id,
    version: scenario.version,
    label: resolved.persona.label,
    category: resolved.persona.category,
    timezone: resolved.persona.timezone,
    persona: resolved.persona,
    planSpanWeeks: scenario.planSpanWeeks,
    prescriptionWeeks: scenario.prescriptionWeeks,
    dates: resolved.dates,
    events: resolved.events,
    evidence: resolved.evidence,
    facts: resolved.facts,
    openingMessage: resolved.openingMessage,
    openingFactIds: scenario.openingFactIds,
    expectations: scenario.expectations,
    limits: scenario.limits,
    voice,
  };
}

export type Scenario = ReturnType<typeof buildScenario>;

/** The persona's own authored communication style, used when no voice profile is chosen. */
export function personaVoice(persona: Persona): ScenarioVoice {
  return {
    id: 'persona',
    version: persona.version,
    label: persona.communication.style,
    description: `An ordinary athlete who speaks in this style: ${persona.communication.style}.`,
    traits: [],
    examples: [],
  };
}

export async function scenarioIds() {
  return (await loadDataset()).scenarios.map((scenario) => scenario.id);
}

export async function suiteScenarioIds(id: string) {
  const suite = (await loadDataset()).suites.find((item) => item.id === id);
  if (!suite) throw new Error(`Unknown suite ${id}.`);
  return suite.scenarios.map((item) => item.id);
}

/** `voice` is a voice profile ID, `persona` for the persona's own style, or `none`. */
export async function loadScenario(id: string, voice = 'persona', now = new Date()) {
  const dataset = await loadDataset();
  const scenario = dataset.scenarios.find((item) => item.id === id);
  if (!scenario)
    throw new Error(
      `Unknown scenario ${id}. Available: ${dataset.scenarios.map((item) => item.id).join(', ')}.`,
    );
  const persona = dataset.personas.find(
    (item) => item.id === scenario.persona.id && item.version === scenario.persona.version,
  );
  if (!persona) throw new Error(`Missing persona for ${id}.`);
  let selected: ScenarioVoice | null = null;
  if (voice === 'persona')
    selected = personaVoice({
      ...persona,
      communication: scenario.personaOverrides?.communication ?? persona.communication,
    });
  else if (voice !== 'none') {
    const voices = await loadVoices();
    const profile = voices.find((item) => item.id === voice);
    if (!profile)
      throw new Error(
        `Unknown voice ${voice}. Use persona, none or one of: ${voices.map((item) => item.id).join(', ')}.`,
      );
    const { schemaVersion: _schema, ...rest } = profile;
    selected = rest;
  }
  return buildScenario(persona, scenario, now, selected);
}

export type AthleteAction = { factIds: string[]; intent: 'answer' | 'generate' | 'unknown' };

export function generateRequest(scenario: Scenario) {
  return `Please go ahead and create the agreed first ${scenario.prescriptionWeeks} weeks of my plan.`;
}

/** The model selects facts; only code renders their authored values. */
export function renderAthleteAction(scenario: Scenario, action: AthleteAction) {
  const ids = [...new Set(action.factIds)];
  for (const id of ids)
    if (!Object.hasOwn(scenario.facts, id)) throw new Error('Simulator selected an unknown fact.');
  const facts = ids.map((id) => scenario.facts[id]!);
  if (action.intent === 'generate') facts.push(generateRequest(scenario));
  if (action.intent === 'unknown' || !facts.length)
    facts.push(scenario.persona.communication.unknownResponse);
  return { content: facts.join('\n'), factIds: ids, statements: facts };
}

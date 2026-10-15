import { asArray, asNumber, asString, isObject, objects, type Json } from './json';

/** Facts the retired running-poc scenario's discovery check required. */
const LEGACY_REQUIRED = ['dates', 'training', 'frequency', 'availability', 'fitness'];

/**
 * Presents a saved scenario in one shape. Dataset scenarios (`edition: v1`) carry a structured
 * persona; the retired running-poc scenario stored running-only expectations and free text. The
 * session analysis reads the summary fields below, and the load chart reads the persona.
 */
export function normalizeScenario(raw: Json | null): Json | null {
  if (!raw) return null;
  if (raw.edition !== 'v1') {
    const expectations = isObject(raw.expectations) ? raw.expectations : {};
    const dates = isObject(raw.dates) ? raw.dates : {};
    const eventDate = asString(dates.eventDate);
    return {
      ...raw,
      expectations: { ...expectations, requiredDiscovery: LEGACY_REQUIRED },
      events: eventDate ? [{ label: 'Goal race', date: eventDate }] : [],
      label: 'Retired running-poc scenario',
    };
  }
  const persona = isObject(raw.persona) ? raw.persona : {};
  const sports = objects(persona.sports);
  // Distance-based analysis follows running, or swimming for a swim-only athlete.
  // The legacy volume chart has one distance series; avoid comparing mixed-sport
  // totals to one sport's baseline. The load chart handles per-sport quantities.
  const primary =
    sports.length === 1 && ['run', 'swim'].includes(asString(sports[0]?.sport) ?? '')
      ? sports[0]
      : undefined;
  const runEvidence = objects(raw.evidence).find((item) => item.system === 'run_pace');
  const evidenceInput = isObject(runEvidence?.input) ? runEvidence.input : {};
  const availability = objects(persona.availability);
  const dates = isObject(raw.dates) ? raw.dates : {};
  const facts = isObject(raw.facts) ? raw.facts : {};
  const expectations = isObject(raw.expectations) ? raw.expectations : {};
  return {
    ...raw,
    dates: {
      ...dates,
      eventDate: asString(dates.endDate),
      observedOn: asString(runEvidence?.observedOn),
    },
    facts: {
      ...facts,
      // The unit preference lives with the persona's preferences.
      constraints: [asString(facts.constraints), asString(facts.preferences)]
        .filter(Boolean)
        .join(' '),
    },
    expectations: {
      ...expectations,
      planningWeeks: asNumber(raw.prescriptionWeeks),
      goalWeeks: asNumber(raw.planSpanWeeks),
      sessionsPerWeek:
        expectations.frequencyPolicy === 'sport_exposures'
          ? null
          : sports.reduce((total, sport) => total + (asNumber(sport.desiredSessions) ?? 0), 0),
      weeklyDistanceMetres: asNumber(primary?.weeklyDistanceMetres),
      longestDistanceMetres: asNumber(primary?.longestDistanceMetres),
      raceDistanceMetres: asNumber(evidenceInput.distanceMetres),
      raceDurationSeconds: asNumber(evidenceInput.durationSeconds),
      availableWeekdays: availability.map((day) => asNumber(day.weekday)).filter(Boolean),
      dayLimits: Object.fromEntries(
        availability.map((day) => [String(asNumber(day.weekday)), asNumber(day.maxMinutes)]),
      ),
      requiredDiscovery: asArray(expectations.requiredDiscovery),
    },
  };
}

export function requiredFacts(scenario: Json | null): string[] {
  const expectations = isObject(scenario?.expectations) ? scenario.expectations : {};
  const listed = asArray(expectations.requiredDiscovery).filter(
    (item): item is string => typeof item === 'string',
  );
  return listed.length > 0 ? listed : LEGACY_REQUIRED;
}

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  coverageMarkdown,
  loadDataset,
  PersonaSchema,
  resolveDatasetScenario,
  validateDataset,
} from './datasets.js';

describe('versioned athlete datasets', () => {
  it('accounts for all 61 combinations and keeps the generated tracker current', async () => {
    const dataset = await loadDataset();
    expect(dataset.personas).toHaveLength(7);
    expect(dataset.scenarios).toHaveLength(8);
    expect(dataset.catalogue.personas).toHaveLength(28);
    expect(dataset.catalogue.scenarios).toHaveLength(61);
    expect(dataset.catalogue.scenarios.filter((item) => item.status === 'planned')).toHaveLength(
      53,
    );
    expect(dataset.suites[0]!.scenarios).toHaveLength(8);
    expect(await readFile(new URL('../datasets/COVERAGE.md', import.meta.url), 'utf8')).toBe(
      coverageMarkdown(dataset),
    );
  });

  it('compares annual and standard spans with identical athlete facts and prescription dates', async () => {
    const dataset = await loadDataset();
    const persona = dataset.personas.find((item) => item.id === 'hybrid-improver')!;
    const short = dataset.scenarios.find((item) => item.id === 'hybrid-improver')!;
    const annual = dataset.scenarios.find((item) => item.id === 'hybrid-improver-annual')!;
    const now = new Date('2026-10-13T12:00:00Z');
    const a = resolveDatasetScenario(persona, short, now);
    const b = resolveDatasetScenario(persona, annual, now);
    expect(a.dates.coverageEndDate).toBe(b.dates.coverageEndDate);
    expect(a.dates.endDate).not.toBe(b.dates.endDate);
    expect(a.persona).toEqual(b.persona);
    for (const key of Object.keys(persona.factTemplates)) expect(a.facts[key]).toBe(b.facts[key]);
    expect(b.openingMessage).toContain('52-week');
    expect(b.facts.horizon).toContain('first 4 weeks');
    expect(Object.values(b.facts).join('\n')).not.toContain(
      annual.expectations.reviewAnchors.goal_fit,
    );
  });

  it('retains zero and unknown baselines and rejects malformed or unsupported data', async () => {
    const dataset = await loadDataset();
    const strength = dataset.personas.find((item) => item.id === 'strength-beginner')!;
    expect(strength.sports[0]!.currentSessions).toBe(0);
    const swim = dataset.personas.find((item) => item.id === 'swim-beginner')!;
    expect(swim.sports[0]).toMatchObject({
      longestDistanceMetres: 300,
      comfortableContinuousDistanceMetres: 100,
    });
    const unknown = structuredClone(dataset.personas.find((item) => item.id === 'cycle-beginner')!);
    if (unknown.sports[0]!.sport === 'cycle') unknown.sports[0]!.weeklyDurationSeconds = null;
    expect(PersonaSchema.parse(unknown).sports[0]).toMatchObject({ weeklyDurationSeconds: null });
    expect(() => PersonaSchema.parse({ ...unknown, secretKey: 'not-a-dataset-field' })).toThrow();
    unknown.availability[0]!.maxMinutes = -1;
    expect(() => PersonaSchema.parse(unknown)).toThrow();
  });

  it('supports controlled persona overrides without changing the base fact sheet', async () => {
    const dataset = await loadDataset();
    const persona = dataset.personas.find((item) => item.id === 'hybrid-improver')!;
    const scenario = structuredClone(
      dataset.scenarios.find((item) => item.id === 'hybrid-improver')!,
    );
    scenario.personaOverrides = { age: 60 };
    const resolved = resolveDatasetScenario(persona, scenario, new Date('2026-10-13T12:00:00Z'));
    expect(resolved.persona.age).toBe(60);
    expect(resolved.facts.constraints).toContain("I'm 60.");
    expect(persona.age).toBe(38);
    expect(resolved.persona.sports).toEqual(persona.sports);
    scenario.personaOverrides = {
      availability: [
        { weekday: 2, maxMinutes: 45, preferred: false },
        { weekday: 6, maxMinutes: 60, preferred: false },
      ],
    };
    expect(() =>
      resolveDatasetScenario(persona, scenario, new Date('2026-10-13T12:00:00Z')),
    ).not.toThrow();
    expect(
      resolveDatasetScenario(persona, scenario, new Date('2026-10-13T12:00:00Z')).persona
        .availability,
    ).toHaveLength(2);
  });

  it('keeps changeable evidence, per-sport baseline periods and opening horizons consistent', async () => {
    const dataset = await loadDataset();
    const now = new Date('2026-10-13T12:00:00Z');
    for (const id of ['triathlon-intermediate', 'gym-experienced', 'hybrid-improver']) {
      const persona = dataset.personas.find((item) => item.id === id)!;
      const scenario = structuredClone(dataset.scenarios.find((item) => item.id === id)!);
      const sports = structuredClone(persona.sports);
      sports.forEach((sport, index) => {
        sport.recentBaselineWeeks = 8 + index;
      });
      const performanceEvidence = structuredClone(persona.performanceEvidence);
      const running = performanceEvidence.find((item) => item.system === 'run_pace');
      if (running?.system === 'run_pace') {
        running.input.distanceMetres = 10000;
        running.input.durationSeconds = 3600;
      }
      scenario.personaOverrides = { sports, performanceEvidence };
      const resolved = resolveDatasetScenario(persona, scenario, now);
      for (const sport of sports)
        expect(resolved.facts.training).toContain(`last ${sport.recentBaselineWeeks} weeks`);
      expect(resolved.facts.training).not.toContain('last six weeks');
      if (running) {
        expect(resolved.facts.fitness).toContain('10 km');
        expect(resolved.facts.fitness).toContain('60 minutes');
        expect(resolved.facts.fitness).not.toContain('5 km');
      }
    }
    const scenario = structuredClone(dataset.scenarios.find((item) => item.id === 'running-poc')!);
    scenario.prescriptionWeeks = 8;
    const persona = dataset.personas.find((item) => item.id === 'running-poc')!;
    const resolved = resolveDatasetScenario(persona, scenario, now);
    expect(resolved.openingMessage).toContain('first 8 weeks');
    expect(resolved.facts.horizon).toContain('first 8 weeks');
    expect(resolved.openingMessage).not.toContain('four weeks');
  });

  it('rejects broken references, missing facts and impossible horizons or access slots', async () => {
    const source = await loadDataset();
    const broken = structuredClone(source);
    broken.scenarios[0]!.persona.version = 99;
    expect(() => validateDataset(broken)).toThrow('reference mismatch');
    const missing = structuredClone(source);
    missing.scenarios[0]!.expectations.requiredDiscovery.push('unavailable-fact');
    expect(() => validateDataset(missing)).toThrow('Missing fact');
    const horizon = structuredClone(source);
    horizon.scenarios[0]!.prescriptionWeeks = 100;
    expect(() => validateDataset(horizon)).toThrow('Prescription exceeds span');
    const access = structuredClone(source);
    access.personas.find(
      (item) => item.id === 'triathlon-intermediate',
    )!.accessRestrictions[0]!.maxMinutes = 100;
    expect(() => validateDataset(access)).toThrow('Facility access exceeds availability');
  });

  it('rejects stale inventory and prevents reserved families entering the pilot', async () => {
    const source = await loadDataset();
    const stale = structuredClone(source);
    stale.catalogue.scenarios.find((item) => item.id === 'hybrid-improver-annual')!.status =
      'planned';
    expect(() => validateDataset(stale)).toThrow('Planned catalogue mismatch');
    const heldout = structuredClone(source);
    heldout.catalogue.personas.find((item) => item.id === 'running-poc')!.split = 'holdout';
    heldout.catalogue.scenarios
      .filter((item) => item.familyId === 'running-poc')
      .forEach((item) => {
        item.split = 'holdout';
      });
    heldout.scenarios.find((item) => item.id === 'running-poc')!.split = 'holdout';
    expect(() => validateDataset(heldout)).toThrow('Holdout in development suite');
  });

  it('never silently renders missing or inherited placeholders as athlete facts', async () => {
    const dataset = await loadDataset();
    const scenario = dataset.scenarios.find((item) => item.id === 'cycle-beginner')!;
    const persona = structuredClone(dataset.personas.find((item) => item.id === 'cycle-beginner')!);
    for (const placeholder of ['invented', 'toString']) {
      persona.factTemplates.fitness = `My fitness is {{${placeholder}}}.`;
      expect(() =>
        resolveDatasetScenario(persona, scenario, new Date('2026-10-13T12:00:00Z')),
      ).toThrow('Unknown fact placeholder');
    }
  });
});

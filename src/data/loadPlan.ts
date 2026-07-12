import YAML from 'yaml';
import { PhaseSchema, PlanSchema, SessionSchema, WeekSchema, type Phase, type Plan, type Session, type Week } from './schema';

const parse = <T>(raw: string, label: string, fn: (value: unknown)=>T): T => {
  try { return fn(YAML.parse(raw)); } catch (e) { throw new Error(`Invalid ${label}: ${String(e)}`); }
};

const planRaw = import.meta.glob('../../plans/cardiff-half-2026/plan.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string,string>;
const phaseRaws = import.meta.glob('../../plans/cardiff-half-2026/phases/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string,string>;
const weekRaws = import.meta.glob('../../plans/cardiff-half-2026/weeks/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string,string>;
const sessionRaws = import.meta.glob('../../plans/cardiff-half-2026/sessions/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string,string>;

export function loadPlan() {
  const plan: Plan = parse(Object.values(planRaw)[0], 'plan', PlanSchema.parse);
  const phases: Phase[] = Object.entries(phaseRaws).map(([k,v]) => parse(v, k, PhaseSchema.parse)).sort((a,b)=>a.number-b.number);
  const sessions: Session[] = Object.entries(sessionRaws).map(([k,v]) => parse(v, k, SessionSchema.parse)).sort((a,b)=>a.date.localeCompare(b.date));
  const byId = new Map(sessions.map(s => [s.id, s]));
  const weeks: Week[] = Object.entries(weekRaws).map(([k,v]) => {
    const w = parse(v, k, WeekSchema.parse);
    return { ...w, sessionObjects: w.sessions.map(id => byId.get(id)).filter(Boolean) as Session[] };
  }).sort((a,b)=>a.number-b.number);
  return { plan, phases, weeks, sessions };
}

import { useEffect, useMemo, useState } from 'react';
import { VerdictBadge } from './components/Badges';
import { useResultsIndex } from './lib/data';
import { demoCalibration, demoRuns } from './lib/demo';
import { formatDateTime, formatPercent, VERDICT_ORDER } from './lib/format';
import {
  applyFilters,
  countBy,
  EMPTY_FILTERS,
  isFiltered,
  toggle,
  type Filters,
} from './lib/filters';
import { modelColors, modelName, sortReasoning } from './lib/models';
import { href, useRoute, type Route, type Section } from './lib/route';
import type { CalibrationRun, ResultsIndex, RunSummary } from './types';
import { promptKey } from './lib/cohorts';
import { Compare } from './views/Compare';
import { Conversations } from './views/Conversations';
import { Grader } from './views/Grader';
import { Overview } from './views/Overview';
import { ReviewPanel } from './views/session/ReviewPanel';
import { Session } from './views/session/Session';

interface Settings {
  theme: 'dark' | 'light';
  showScripted: boolean;
  showDemo: boolean;
}

const SETTINGS_KEY = 'coachalytics.settings';
const DEFAULT_SETTINGS: Settings = { theme: 'dark', showScripted: false, showDemo: false };

function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return {
        ...DEFAULT_SETTINGS,
        ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>),
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);
  return [settings, setSettings] as const;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'compare', label: 'Compare' },
  { id: 'grader', label: 'Grader' },
];

type ViewTab = { id: string; label: string } | 'divider';

function viewTabs(route: Route): ViewTab[] {
  if (route.section === 'overview') {
    return [
      { id: 'quality-tokens', label: 'Quality vs tokens' },
      { id: 'quality-time', label: 'Quality vs time' },
      'divider',
      { id: 'verdicts', label: 'Verdicts' },
      { id: 'criteria', label: 'Criteria' },
      { id: 'tokens', label: 'Tokens per run' },
    ];
  }
  if (route.section === 'conversations' && route.id) {
    return [
      { id: 'flags', label: 'Flags' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'transcript', label: 'Conversation' },
      'divider',
      { id: 'discovery', label: 'Discovery' },
      { id: 'beliefs', label: 'Recorded' },
      { id: 'decisions', label: 'Decisions' },
      'divider',
      { id: 'plan', label: 'Plan' },
      { id: 'load', label: 'Load' },
      { id: 'assessment', label: 'Assessment' },
      { id: 'prompts', label: 'Prompts' },
    ];
  }
  if (route.section === 'conversations') {
    return [
      { id: 'failure-modes', label: 'What goes wrong' },
      { id: 'discovery-funnel', label: 'Discovery' },
      { id: 'behaviour', label: 'Behaviour' },
      { id: 'reliability', label: 'Reliability' },
      'divider',
      { id: 'conversation-list', label: 'All conversations' },
    ];
  }
  if (route.section === 'compare') {
    return [
      { id: 'metrics', label: 'Metrics' },
      { id: 'mode-diff', label: 'Failure modes' },
      { id: 'distributions', label: 'Distributions' },
    ];
  }
  if (route.section === 'grader') {
    return [
      { id: 'human', label: 'You vs reviewer' },
      { id: 'agreement', label: 'Agreement' },
      { id: 'fixtures', label: 'Fixture matrix' },
      { id: 'judgements', label: 'Judgements' },
    ];
  }
  return [];
}

function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join('|');
  useEffect(() => {
    const update = () => {
      let current = ids[0] ?? null;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= 140) current = id;
      }
      setActive(current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

function Header({
  route,
  settings,
  onSettings,
  onMenu,
}: {
  route: Route;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onMenu: () => void;
}) {
  const tabs = viewTabs(route);
  const ids = tabs.flatMap((tab) => (tab === 'divider' ? [] : [tab.id]));
  const active = useActiveSection(ids);
  return (
    <header className="app-header">
      <a className="brand" href={href('overview')}>
        <strong>
          <span>coach</span>alytics
        </strong>
      </a>
      <nav className="section-tabs" aria-label="Sections">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={href(section.id)}
            className={route.section === section.id ? 'active' : undefined}
          >
            {section.label}
          </a>
        ))}
      </nav>
      <nav className="view-tabs" aria-label="Views">
        {tabs.map((tab, index) =>
          tab === 'divider' ? (
            <span key={`divider-${index}`} className="tab-divider" />
          ) : (
            <button
              key={tab.id}
              className={active === tab.id ? 'active' : undefined}
              onClick={() => {
                const element = document.getElementById(tab.id);
                if (element) window.scrollTo({ top: element.offsetTop - 60, behavior: 'smooth' });
              }}
            >
              {tab.label}
            </button>
          ),
        )}
      </nav>
      <div className="header-actions">
        <button
          className="icon-button"
          aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} theme`}
          title="Toggle theme"
          onClick={() =>
            onSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })
          }
        >
          {settings.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <details className="chart-settings">
          <summary className="icon-button" aria-label="Settings" title="Settings">
            <SlidersIcon />
          </summary>
          <div className="settings-popover">
            <label>
              <input
                type="checkbox"
                checked={settings.showScripted}
                onChange={(event) =>
                  onSettings({ ...settings, showScripted: event.target.checked })
                }
              />
              <span className={`selection${settings.showScripted ? ' checked' : ''}`} />
              Include scripted runs
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showDemo}
                onChange={(event) => onSettings({ ...settings, showDemo: event.target.checked })}
              />
              <span className={`selection${settings.showDemo ? ' checked' : ''}`} />
              Show demo models
            </label>
            <p>
              Scripted runs exercise the harness with a fixture model. Demo models are synthetic and
              drawn hollow.
            </p>
          </div>
        </details>
        <button className="icon-button mobile-only" aria-label="Filters" onClick={onMenu}>
          <SlidersIcon />
        </button>
      </div>
    </header>
  );
}

function RunSidebar({
  pool,
  filters,
  onFilters,
  colors,
  settings,
  onSettings,
  scriptedCount,
  highlighted,
  onHighlight,
  index,
}: {
  pool: RunSummary[];
  filters: Filters;
  onFilters: (filters: Filters) => void;
  colors: Map<string, string>;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  scriptedCount: number;
  highlighted: string | null;
  onHighlight: (model: string | null) => void;
  index: ResultsIndex;
}) {
  const visible = applyFilters(pool, filters);
  const models = countBy(pool, (run) => run.coachModel);
  const verdicts = countBy(pool, (run) => run.verdict);
  const scenarios = countBy(pool, (run) => run.scenarioId);
  const prompts = countBy(pool, promptKey);
  const reasoning = sortReasoning(pool.map((run) => run.reasoning));
  return (
    <>
      <div className="side-heading">
        <h2>
          Runs <span>{visible.length}</span>
          <span className="slash">/</span>
          <span>{pool.length}</span>
        </h2>
        {isFiltered(filters) && (
          <button className="text-button" onClick={() => onFilters(EMPTY_FILTERS)}>
            Reset
          </button>
        )}
      </div>

      <div className="segmented" role="group" aria-label="Data source">
        <button
          aria-pressed={!settings.showDemo}
          onClick={() => onSettings({ ...settings, showDemo: false })}
        >
          Live runs
        </button>
        <button
          aria-pressed={settings.showDemo}
          onClick={() => onSettings({ ...settings, showDemo: true })}
        >
          + Demo models
        </button>
      </div>

      <div className="search">
        <SearchIcon />
        <input
          placeholder="Search runs"
          value={filters.search}
          onChange={(event) => onFilters({ ...filters, search: event.target.value })}
          aria-label="Search runs"
        />
      </div>

      {reasoning.length > 0 && (
        <div className="effort-filter">
          <h3>Reasoning</h3>
          <div>
            {reasoning.map((level) => {
              const checked = !filters.hiddenReasoning.includes(level);
              return (
                <button
                  key={level}
                  className="chip"
                  aria-pressed={checked}
                  onClick={() =>
                    onFilters({
                      ...filters,
                      hiddenReasoning: toggle(filters.hiddenReasoning, level),
                    })
                  }
                >
                  <span className={`selection${checked ? ' checked' : ''}`} />
                  {level}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <section className="model-section">
        <div className="section-head">
          <h3>Coach models</h3>
        </div>
        {[...models.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([model, count]) => {
            const hidden = filters.hiddenModels.includes(model);
            return (
              <button
                key={model}
                className={`model-row${hidden ? ' hidden' : ''}${highlighted === model ? ' highlighted' : ''}`}
                aria-pressed={!hidden}
                onClick={() =>
                  onFilters({ ...filters, hiddenModels: toggle(filters.hiddenModels, model) })
                }
                onMouseEnter={() => onHighlight(model)}
                onMouseLeave={() => onHighlight(null)}
              >
                <i className="model-dot" style={{ background: colors.get(model) }} />
                <span>{modelName(model)}</span>
                <small>{count}</small>
              </button>
            );
          })}
      </section>

      <section className="model-section">
        <div className="section-head">
          <h3>Prompt</h3>
        </div>
        {[...prompts.entries()].map(([prompt, count]) => {
          const hidden = filters.hiddenPrompts.includes(prompt);
          return (
            <button
              key={prompt}
              className={`model-row${hidden ? ' hidden' : ''}`}
              aria-pressed={!hidden}
              onClick={() =>
                onFilters({ ...filters, hiddenPrompts: toggle(filters.hiddenPrompts, prompt) })
              }
            >
              <span className="mono">{prompt}</span>
              <small>{count}</small>
            </button>
          );
        })}
      </section>

      <section className="model-section">
        <div className="section-head">
          <h3>Verdict</h3>
        </div>
        {VERDICT_ORDER.filter((verdict) => verdicts.has(verdict)).map((verdict) => {
          const hidden = filters.hiddenVerdicts.includes(verdict);
          return (
            <button
              key={verdict}
              className={`model-row${hidden ? ' hidden' : ''}`}
              aria-pressed={!hidden}
              onClick={() =>
                onFilters({ ...filters, hiddenVerdicts: toggle(filters.hiddenVerdicts, verdict) })
              }
            >
              <VerdictBadge verdict={verdict} />
              <small>{verdicts.get(verdict)}</small>
            </button>
          );
        })}
      </section>

      <section className="model-section">
        <div className="section-head">
          <h3>Scenario</h3>
        </div>
        {[...scenarios.entries()].map(([scenario, count]) => {
          const hidden = filters.hiddenScenarios.includes(scenario);
          return (
            <button
              key={scenario}
              className={`model-row${hidden ? ' hidden' : ''}`}
              aria-pressed={!hidden}
              onClick={() =>
                onFilters({
                  ...filters,
                  hiddenScenarios: toggle(filters.hiddenScenarios, scenario),
                })
              }
            >
              <span className="mono">{scenario}</span>
              <small>{count}</small>
            </button>
          );
        })}
      </section>

      <div className="browse-options">
        <button onClick={() => onSettings({ ...settings, showScripted: !settings.showScripted })}>
          <span className={`selection${settings.showScripted ? ' checked' : ''}`} />
          Include scripted runs ({scriptedCount})
        </button>
        <p className="source-path" title={index.root}>
          {index.root.split('/').slice(-3).join('/')}
        </p>
      </div>
    </>
  );
}

function GraderSidebar({
  calibrations,
  selected,
}: {
  calibrations: CalibrationRun[];
  selected: string | null;
}) {
  return (
    <>
      <div className="side-heading">
        <h2>
          Calibration suites <span>{calibrations.length}</span>
        </h2>
      </div>
      <section className="model-section">
        {calibrations.map((calibration) => (
          <a
            key={calibration.id}
            href={href('grader', calibration.id)}
            className={`suite-row${calibration.id === selected ? ' active' : ''}`}
          >
            <span className="suite-title">
              {calibration.scripted
                ? 'Scripted stand-in'
                : modelName(calibration.reviewerModel ?? 'unknown')}
              {calibration.demo && <small className="tag tag-accent">demo</small>}
            </span>
            <span className="suite-meta">
              {formatDateTime(calibration.startedAt)} · {calibration.split} ×{calibration.repeat}
            </span>
            <span className="suite-score">
              {formatPercent(
                calibration.labeledJudgments === 0
                  ? null
                  : calibration.judgmentMatches / calibration.labeledJudgments,
              )}{' '}
              agreement · {calibration.missedDefects} missed
            </span>
          </a>
        ))}
      </section>
    </>
  );
}

export function App() {
  const route = useRoute();
  const index = useResultsIndex();
  const [settings, setSettings] = useSettings();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [menuRoute, setMenuRoute] = useState<string | null>(null);
  const routeKey = `${route.section}/${route.id ?? ''}`;
  const menuOpen = menuRoute === routeKey;

  const demo = useMemo(() => demoRuns(), []);
  const data = index.status === 'ready' ? index.data : null;

  const derived = useMemo(() => {
    const real = data?.runs ?? [];
    const all = settings.showDemo ? [...real, ...demo] : real;
    const pool = settings.showScripted ? all : all.filter((run) => !run.scripted);
    const colors = modelColors([...real, ...demo].map((run) => run.coachModel));
    const fixtures =
      data?.calibrations.find((calibration) => calibration.fixtures.length > 0)?.fixtures ?? [];
    const demoSuite = settings.showDemo ? demoCalibration(fixtures) : null;
    const calibrations = [...(demoSuite ? [demoSuite] : []), ...(data?.calibrations ?? [])];
    return {
      pool,
      colors,
      calibrations,
      scriptedCount: all.filter((run) => run.scripted).length,
      realModels: new Set(real.filter((run) => !run.scripted).map((run) => run.coachModel)).size,
    };
  }, [data, demo, settings.showDemo, settings.showScripted]);

  if (index.status === 'loading') return <div className="boot">Loading results…</div>;
  if (index.status === 'error') {
    return (
      <div className="boot">
        <h1>coachalytics</h1>
        <p>{index.message}</p>
      </div>
    );
  }

  const visible = applyFilters(derived.pool, filters);
  const session = route.section === 'conversations' && route.id !== null;
  const demoRun = session ? (demo.find((run) => run.id === route.id) ?? null) : null;
  const detailRun = route.id
    ? [...index.data.runs, ...demo].find((run) => run.id === route.id)
    : undefined;
  const selectedCalibration =
    derived.calibrations.find((calibration) => calibration.id === route.id) ??
    derived.calibrations[0] ??
    null;

  return (
    <div className="app">
      <Header
        route={route}
        settings={settings}
        onSettings={setSettings}
        onMenu={() => setMenuRoute(menuOpen ? null : routeKey)}
      />
      {settings.showDemo && (
        <div className="demo-banner">
          Demo models are synthetic, drawn hollow, and exist only in this browser. Switch to{' '}
          <button onClick={() => setSettings({ ...settings, showDemo: false })}>live runs</button>{' '}
          for real results.
        </div>
      )}
      <div className="body-layout">
        <main>
          {route.section === 'overview' && (
            <Overview
              runs={visible}
              colors={derived.colors}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              demoAvailable={!settings.showDemo && derived.realModels < 2}
              onEnableDemo={() => setSettings({ ...settings, showDemo: true })}
            />
          )}
          {route.section === 'conversations' && !route.id && (
            <Conversations runs={visible} colors={derived.colors} />
          )}
          {session && route.id && (
            <Session
              key={route.id}
              id={route.id}
              demo={demoRun}
              color={detailRun ? derived.colors.get(detailRun.coachModel) : undefined}
            />
          )}
          {route.section === 'compare' && (
            <Compare
              runs={visible}
              demoAvailable={!settings.showDemo}
              onEnableDemo={() => setSettings({ ...settings, showDemo: true })}
            />
          )}
          {route.section === 'grader' && (
            <Grader calibration={selectedCalibration} runs={index.data.runs} />
          )}
          <footer>
            <span>
              {index.data.runs.length} runs · {index.data.calibrations.length} calibration suites ·
              refreshed {formatDateTime(index.data.generatedAt)}
            </span>
            <span>
              Model grading is provisional and has not been calibrated against a human coach.
            </span>
          </footer>
        </main>
        <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
          {session && detailRun ? (
            <ReviewPanel
              key={detailRun.id + (detailRun.review?.updatedAt ?? '')}
              run={detailRun}
              queue={visible}
            />
          ) : route.section === 'grader' ? (
            <GraderSidebar
              calibrations={derived.calibrations}
              selected={selectedCalibration?.id ?? null}
            />
          ) : (
            <RunSidebar
              pool={derived.pool}
              filters={filters}
              onFilters={setFilters}
              colors={derived.colors}
              settings={settings}
              onSettings={setSettings}
              scriptedCount={derived.scriptedCount}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              index={index.data}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

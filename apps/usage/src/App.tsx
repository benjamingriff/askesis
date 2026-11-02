import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_USAGE_FILTERS, syntheticUsage, type UsageFilters } from './lib/usage';
import { href, useRoute, type Route } from './lib/route';
import { UsageSection } from './views/UsageSection';

type Theme = 'dark' | 'light';
type ViewTab = { id: string; label: string } | 'divider';

const THEME_KEY = 'askesis-usage.theme';

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark',
  );
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return [theme, setTheme] as const;
}

function viewTabs(route: Route): ViewTab[] {
  if (route.athleteId) {
    return [
      { id: 'athlete-spend', label: 'Spend' },
      { id: 'athlete-runs', label: 'Runs' },
    ];
  }
  return [
    { id: 'spend', label: 'Spend' },
    { id: 'cache', label: 'Cache' },
    { id: 'mix', label: 'Tokens vs spend' },
    'divider',
    { id: 'customers', label: 'Customers' },
    { id: 'concentration', label: 'Concentration' },
    { id: 'outliers', label: 'Outliers' },
    'divider',
    { id: 'expensive', label: 'Expensive runs' },
    { id: 'coverage', label: 'Coverage' },
  ];
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
      // A short final section never reaches the threshold; at the page end, select it.
      const atEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const last = ids.filter((id) => document.getElementById(id)).at(-1);
      if (atEnd && window.scrollY > 0 && last) current = last;
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
  athleteName,
  theme,
  onTheme,
  onMenu,
}: {
  route: Route;
  athleteName: string | null;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onMenu: () => void;
}) {
  const tabs = viewTabs(route);
  const ids = tabs.flatMap((tab) => (tab === 'divider' ? [] : [tab.id]));
  const active = useActiveSection(ids);
  const tabKey = ids.join('|');
  const nav = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    // Fade whichever edge hides tabs, so a clipped tab bar reads as scrollable.
    const update = () =>
      setOverflow({
        start: element.scrollLeft > 1,
        end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [tabKey]);
  return (
    <header className="app-header">
      <a className="brand" href={href()}>
        <strong>
          <span>usage</span>alytics
        </strong>
      </a>
      <nav className="section-tabs" aria-label="Sections">
        <a href={href()} className={route.athleteId ? undefined : 'active'}>
          Overview
        </a>
        {athleteName && (
          <a href={href(route.athleteId)} className="active">
            {athleteName}
          </a>
        )}
      </nav>
      <nav
        ref={nav}
        className="view-tabs"
        aria-label="Views"
        data-overflow-start={overflow.start || undefined}
        data-overflow-end={overflow.end || undefined}
      >
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
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title="Toggle theme"
          onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button className="icon-button mobile-only" aria-label="Filters" onClick={onMenu}>
          <SlidersIcon />
        </button>
      </div>
    </header>
  );
}

export function App() {
  const route = useRoute();
  const [theme, setTheme] = useTheme();
  const [filters, setFilters] = useState<UsageFilters>(EMPTY_USAGE_FILTERS);
  const [menuRoute, setMenuRoute] = useState<string | null>(null);
  const routeKey = route.athleteId ?? '';
  const menuOpen = menuRoute === routeKey;
  const athletes = useMemo(() => syntheticUsage().athletes, []);
  const athleteName = route.athleteId
    ? (athletes.find((athlete) => athlete.id === route.athleteId)?.name ?? null)
    : null;

  return (
    <div className="app">
      <Header
        route={route}
        athleteName={athleteName}
        theme={theme}
        onTheme={setTheme}
        onMenu={() => setMenuRoute(menuOpen ? null : routeKey)}
      />
      <UsageSection route={route} state={{ filters, setFilters }} menuOpen={menuOpen} />
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

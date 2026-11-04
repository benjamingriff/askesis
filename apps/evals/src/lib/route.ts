import { useEffect, useState } from 'react';

export type Section = 'overview' | 'conversations' | 'compare' | 'grader';

export interface Route {
  section: Section;
  id: string | null;
}

function parse(hash: string): Route {
  const [section, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const id = rest.length > 0 ? decodeURIComponent(rest.join('/')) : null;
  // `runs` was the first version's name for conversations.
  if (section === 'runs' || section === 'conversations') return { section: 'conversations', id };
  if (section === 'grader') return { section, id };
  if (section === 'compare') return { section, id: null };
  return { section: 'overview', id: null };
}

export function href(section: Section, id?: string | null): string {
  return id ? `#/${section}/${encodeURIComponent(id)}` : `#/${section}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

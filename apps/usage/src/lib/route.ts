import { useEffect, useState } from 'react';

/** `#/` is the overview; `#/athletes/<id>` is one customer. */
export interface Route {
  athleteId: string | null;
}

function parse(hash: string): Route {
  const [section, ...rest] = hash.replace(/^#\/?/, '').split('/');
  if (section === 'athletes' && rest.length > 0)
    return { athleteId: decodeURIComponent(rest.join('/')) };
  return { athleteId: null };
}

export function href(athleteId?: string | null): string {
  return athleteId ? `#/athletes/${encodeURIComponent(athleteId)}` : '#/';
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

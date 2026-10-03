import { useEffect, useState } from 'react';
import { localToday } from './format';

/** Keep calendar-based screens current across midnight and suspended browser tabs. */
export function useLocalToday(): string {
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      setToday(localToday());
      clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return today;
}

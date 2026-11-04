import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { localToday } from './format';

/** Keep calendar-based screens current across midnight and a backgrounded app. */
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
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return today;
}

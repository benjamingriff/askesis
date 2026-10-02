import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocalToday } from './use-local-today';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2027, 0, 12, 23, 59, 59));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('advances at successive local midnights and clears its timer when unmounted', () => {
  const { result, unmount } = renderHook(useLocalToday);
  expect(result.current).toBe('2027-01-12');
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe('2027-01-13');
  act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
  expect(result.current).toBe('2027-01-14');
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['focus', 'pageshow', 'visibilitychange'])(
  'catches up after suspension on %s and schedules the next midnight',
  (event) => {
    const { result } = renderHook(useLocalToday);
    vi.setSystemTime(new Date(2027, 0, 14, 23, 59, 59));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
    });
    expect(result.current).toBe('2027-01-14');
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe('2027-01-15');
  },
);

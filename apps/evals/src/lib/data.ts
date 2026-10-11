import { useEffect, useState } from 'react';
import type { HumanReview, ResultsIndex, RunDetail } from '../types';

export type Load<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

const POLL_MS = 15_000;
const REFRESH_EVENT = 'coachalytics:refresh';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      root?: string;
    } | null;
    throw new Error(
      body?.error === 'results_directory_missing'
        ? `No results directory at ${body.root ?? 'the configured path'}. Set EVALS_RESULTS_DIR.`
        : `Request failed with HTTP ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

/** Results index, refreshed periodically so in-progress runs advance. */
export function useResultsIndex(): Load<ResultsIndex> {
  const [state, setState] = useState<Load<ResultsIndex>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchJson<ResultsIndex>('/api/index')
        .then((data) => !cancelled && setState({ status: 'ready', data }))
        .catch((error: unknown) => {
          if (cancelled) return;
          setState((previous) =>
            previous.status === 'ready'
              ? previous
              : {
                  status: 'error',
                  message: error instanceof Error ? error.message : String(error),
                },
          );
        });
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, []);
  return state;
}

/**
 * One conversation's detail. Reloads when a review is saved and, while the run is
 * unfinished, on the index polling interval. A failed reload keeps the last good data.
 */
export function useRunDetail(id: string | null): Load<RunDetail> {
  const [state, setState] = useState<{ id: string; load: Load<RunDetail> } | null>(null);
  const current = state !== null && state.id === id ? state.load : null;
  const unfinished = current?.status === 'ready' && current.data.verdict === 'running';
  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    const load = () => {
      fetchJson<RunDetail>(`/api/runs/${encodeURIComponent(id)}`)
        .then((data) => !cancelled && setState({ id, load: { status: 'ready', data } }))
        .catch((error: unknown) => {
          if (cancelled) return;
          setState((previous) =>
            previous?.id === id && previous.load.status === 'ready'
              ? previous
              : {
                  id,
                  load: {
                    status: 'error',
                    message: error instanceof Error ? error.message : String(error),
                  },
                },
          );
        });
    };
    load();
    window.addEventListener(REFRESH_EVENT, load);
    const timer = unfinished ? window.setInterval(load, POLL_MS) : undefined;
    return () => {
      cancelled = true;
      window.removeEventListener(REFRESH_EVENT, load);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [id, unfinished]);
  return current ?? { status: 'loading' };
}

export async function saveReview(
  id: string,
  review: Omit<HumanReview, 'updatedAt'>,
): Promise<HumanReview> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}/review`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(review),
  });
  if (!response.ok) throw new Error(`Saving the review failed with HTTP ${response.status}`);
  const saved = (await response.json()) as HumanReview;
  window.dispatchEvent(new Event(REFRESH_EVENT));
  return saved;
}

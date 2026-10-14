import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { api } from '../api';
import { useConnectStrava, useRefreshActivities } from '../activity-data';
import { Button, ButtonLink, Card, ErrorState, LoadingState } from '../components/ui';
import { result } from '../lib/result';

/** Strava codes are single-use; React's development double effects must not spend it twice. */
const attempted = new Set<string>();

/**
 * Strava returns here after consent. The authenticated session completes the connection (the
 * signed state proves this athlete started it), then the first sync imports recent activities.
 */
export function StravaCallbackPage() {
  const location = useLocation();
  const [params] = useState(() => new URLSearchParams(location.search));
  const client = useQueryClient();
  const reconnect = useConnectStrava();
  const refresh = useRefreshActivities();
  const finish = useMutation({
    mutationFn: async () => {
      const integrations = result(
        await api.POST('/api/v1/integrations/strava/connect', {
          body: {
            code: params.get('code') ?? '',
            state: params.get('state') ?? '',
            scope: params.get('scope') ?? '',
          },
        }),
      );
      client.setQueryData(['integrations'], integrations);
      return result(await api.POST('/api/v1/integrations/strava/sync'));
    },
    // A failed first sync can still have connected, or marked the grant for reauthorization.
    onSettled: (sync) => refresh(sync?.integrations),
  });
  const code = params.get('code');
  const denied = params.get('error') === 'access_denied';
  const { mutate } = finish;
  useEffect(() => {
    // Keep the one-time code out of history and screenshots.
    window.history.replaceState(null, '', location.pathname);
    if (!code || attempted.has(code)) return;
    attempted.add(code);
    mutate();
  }, [code, mutate, location.pathname]);

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div className="page-heading">
          <span className="label">Connections</span>
          <h1>Strava</h1>
        </div>
      </header>
      <Card className="strava-callback">
        {denied || (!code && !finish.isPending && !finish.data) ? (
          <>
            <p>
              {denied
                ? 'Strava wasn’t connected. You can connect it any time from Settings.'
                : 'This page finishes connecting Strava, but no connection was in progress.'}
            </p>
            <div className="button-row">
              <Button
                variant="primary"
                busy={reconnect.isPending}
                onClick={() => reconnect.mutate()}
              >
                Connect with Strava
              </Button>
              <ButtonLink to="/settings#connections">Back to Settings</ButtonLink>
            </div>
          </>
        ) : finish.error ? (
          <>
            <ErrorState message={finish.error.message} />
            <div className="button-row">
              <Button
                icon={RefreshCw}
                busy={reconnect.isPending}
                onClick={() => reconnect.mutate()}
              >
                Try again
              </Button>
              <ButtonLink to="/settings#connections">Back to Settings</ButtonLink>
            </div>
          </>
        ) : finish.data ? (
          <>
            <p className="strava-done">
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>
                Connected
                {finish.data.integrations.strava.connection?.displayName
                  ? ` as ${finish.data.integrations.strava.connection.displayName}`
                  : ''}
                . Imported {finish.data.imported}{' '}
                {finish.data.imported === 1 ? 'activity' : 'activities'}.
              </span>
            </p>
            <div className="button-row">
              <ButtonLink to="/today" variant="primary" icon={ArrowRight}>
                See today
              </ButtonLink>
              <ButtonLink to="/plan">See your plan</ButtonLink>
            </div>
          </>
        ) : (
          <LoadingState>Connecting Strava and importing your recent activities…</LoadingState>
        )}
      </Card>
    </div>
  );
}

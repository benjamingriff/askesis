import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { LiveProvider } from './live';
import { PlanSelectionProvider } from './plan-selection';

// Returning to the app counts as window focus, so stale reads refresh like a browser tab.
if (Platform.OS !== 'web')
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (state) =>
      handleFocus(state === 'active'),
    );
    return () => subscription.remove();
  });

/** Remounted by account ID: data from one account never becomes another's cache. */
export function AccountQueryProvider({
  children,
  accountId,
}: {
  children: ReactNode;
  accountId: string;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <PlanSelectionProvider accountId={accountId}>
      <QueryClientProvider client={client}>
        <LiveProvider enabled={accountId !== 'signed-out'}>{children}</LiveProvider>
      </QueryClientProvider>
    </PlanSelectionProvider>
  );
}

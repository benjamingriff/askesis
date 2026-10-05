import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { LiveProvider } from './live';
import { PlanPreferenceScope } from './plan-selection';

// Remounted by account ID: data from one account never becomes another's cache.
export function AccountQueryProvider({
  children,
  accountId = 'anonymous',
}: {
  children: ReactNode;
  accountId?: string;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <PlanPreferenceScope.Provider value={accountId}>
      <QueryClientProvider client={client}>
        <LiveProvider enabled={accountId !== 'anonymous' && accountId !== 'signed-out'}>
          {children}
        </LiveProvider>
      </QueryClientProvider>
    </PlanPreferenceScope.Provider>
  );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
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
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </PlanPreferenceScope.Provider>
  );
}

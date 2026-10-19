import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authenticatedFetch } from './api';
import { result } from './lib/result';

export const ACCOUNT_KEY = ['account'] as const;
/** How long a requested deletion can be cancelled; the API applies the same window. */
export const ACCOUNT_GRACE_DAYS = 7;

export const fetchAccount = async () => result(await api.GET('/api/v1/account'));

export function useAccount(enabled = true) {
  return useQuery({ queryKey: ACCOUNT_KEY, enabled, queryFn: fetchAccount });
}

export function useAccountDeletion() {
  const client = useQueryClient();
  const settle = (account: Awaited<ReturnType<typeof requestDeletion>>) => {
    client.setQueryData(ACCOUNT_KEY, account);
    // Everything else is unavailable while deletion is pending, and current again after.
    void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'account' });
  };
  const requestDeletion = async () => result(await api.POST('/api/v1/account/deletion'));
  return {
    request: useMutation({ mutationFn: requestDeletion, onSuccess: settle }),
    cancel: useMutation({
      mutationFn: async () => result(await api.DELETE('/api/v1/account/deletion')),
      onSuccess: settle,
    }),
  };
}

/** Saves everything the account holds as a JSON file. */
export function useDataExport() {
  return useMutation({
    mutationFn: async () => {
      const response = await authenticatedFetch('/api/v1/account/export');
      if (!response.ok) throw new Error('Couldn’t prepare your data. Try again.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `askesis-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
}

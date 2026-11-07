import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { api, authenticatedFetch } from '../lib/api';
import { result } from '../lib/result';

export const ACCOUNT_KEY = ['account'] as const;
/** How long a requested deletion can be cancelled; the API applies the same window. */
export const ACCOUNT_GRACE_DAYS = 7;

export type Account = Awaited<ReturnType<typeof fetchAccount>>;
const fetchAccount = async () => result(await api.GET('/api/v1/account'));

export function useAccount(enabled = true) {
  return useQuery({ queryKey: ACCOUNT_KEY, enabled, queryFn: fetchAccount });
}

/**
 * Requests or cancels account deletion. While it is pending the API refuses everything outside
 * `/account`, and AccountGate shows the deletion notice instead of the app.
 */
export function useAccountDeletion() {
  const client = useQueryClient();
  const settle = (account: Account) => {
    client.setQueryData(ACCOUNT_KEY, account);
    // Everything else is unavailable while deletion is pending, and current again after.
    void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'account' });
  };
  return {
    request: useMutation({
      mutationFn: async () => result(await api.POST('/api/v1/account/deletion')),
      onSuccess: settle,
    }),
    cancel: useMutation({
      mutationFn: async () => result(await api.DELETE('/api/v1/account/deletion')),
      onSuccess: settle,
    }),
  };
}

/**
 * Everything the account holds as one JSON file: written to the cache and offered through the
 * share sheet (Save to Files, AirDrop, Mail…), or downloaded in a browser.
 */
export function useDataExport() {
  return useMutation({
    mutationFn: async () => {
      const response = await authenticatedFetch('/api/v1/account/export');
      if (!response.ok) throw new Error('Couldn’t prepare your data. Try again.');
      const text = await response.text();
      const name = `waddle-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        // WebKit can read the blob after click() returns; revoking at once can empty the file.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      if (!(await Sharing.isAvailableAsync()))
        throw new Error('Sharing isn’t available on this device.');
      const file = new File(Paths.cache, name);
      file.create({ overwrite: true });
      file.write(text);
      try {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          UTI: 'public.json',
          dialogTitle: 'Your Waddle data',
        });
      } finally {
        // iOS resolves once the share sheet has finished with the file, so the cache keeps no
        // copy of the athlete's health data. Android may still be reading it; its cache is purged.
        if (Platform.OS === 'ios' && file.exists) file.delete();
      }
    },
  });
}

/**
 * Whether this deployment offers the in-app coach. When it is hidden, athletes plan with their own
 * agent over MCP and every chat entry point asks that agent instead.
 */
export function useInAppCoach() {
  // AccountGate loads the account before any signed-in screen renders; this only reads it.
  return useAccount(false).data?.features.inAppCoach ?? true;
}

/** Who edits drafts and answers questions: the in-app coach or the athlete's connected agent. */
export function useCoachWord(): 'coach' | 'agent' {
  return useInAppCoach() ? 'coach' : 'agent';
}

/**
 * The icon on "ask" actions: a chat bubble for the in-app coach, a paper plane (always outlined,
 * so every hand-off looks the same) for the athlete's own agent, so nothing suggests a chat
 * inside the app.
 */
export function useAskIcon(outline = false) {
  const coach = useInAppCoach();
  if (coach) return outline ? 'chatbubble-ellipses-outline' : 'chatbubble-ellipses';
  return 'paper-plane-outline';
}

/**
 * Hands a prompt to the athlete's own agent: the Ask your agent screen adds their question, then
 * copies it. `subject` names what it is about, such as the plan, for the screen to show.
 */
export function useAskAgent() {
  return useCallback(
    (prompt: string, subject?: string) =>
      router.push({
        pathname: '/ask-agent',
        params: subject ? { prompt, subject } : { prompt },
      }),
    [],
  );
}

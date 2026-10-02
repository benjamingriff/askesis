import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { buildSeedConversations, newConversation, newId } from '../data/conversations';
import { planCoachTurn } from '../lib/coach-sim';
import type { Conversation, Message, MessagePart } from '../data/types';
import { usePlan } from './plan';

type ChatContextValue = {
  conversations: Conversation[];
  getConversation: (id: string) => Conversation | undefined;
  createConversation: () => string;
  send: (conversationId: string, text: string) => void;
  cancel: (conversationId: string) => void;
  archive: (conversationId: string, archived: boolean) => void;
  markRead: (conversationId: string) => void;
  runUnlockAction: (conversationId: string, messageId: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

type RunHandle = { timers: ReturnType<typeof setTimeout>[]; messageId: string };

function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 44 ? `${clean.slice(0, 41).trimEnd()}…` : clean;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const plan = usePlan();
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    buildSeedConversations(plan.meta, plan.workouts),
  );
  const runs = useRef(new Map<string, RunHandle>());
  const turnCounter = useRef(0);

  const patchConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const patchMessage = useCallback(
    (conversationId: string, messageId: string, fn: (m: Message) => Message) => {
      patchConversation(conversationId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)),
      }));
    },
    [patchConversation],
  );

  const send = useCallback(
    (conversationId: string, rawText: string) => {
      const text = rawText.trim();
      if (!text || runs.current.has(conversationId)) return;

      const userMessage: Message = {
        id: newId('msg'),
        role: 'user',
        createdAt: Date.now(),
        status: 'done',
        parts: [{ type: 'text', text }],
      };
      const replyId = newId('msg');
      const handle: RunHandle = { timers: [], messageId: replyId };
      runs.current.set(conversationId, handle);

      patchConversation(conversationId, (c) => ({
        ...c,
        title: c.title === 'New chat' ? deriveTitle(text) : c.title,
        run: 'running',
        updatedAt: Date.now(),
        messages: [...c.messages, userMessage],
      }));

      const at = (ms: number, fn: () => void) => {
        handle.timers.push(setTimeout(fn, ms));
      };
      const snapshot = plan.getSnapshot();
      const turn = planCoachTurn(text, snapshot, plan.today, turnCounter.current++);
      const started = Date.now();
      let t = 450;

      // Placeholder assistant message appears immediately after a short "queued" beat.
      at(t, () => {
        patchConversation(conversationId, (c) => ({
          ...c,
          messages: [
            ...c.messages,
            {
              id: replyId,
              role: 'assistant',
              createdAt: Date.now(),
              status: 'streaming',
              parts: turn.calls.length
                ? [
                    {
                      type: 'activity',
                      calls: [{ id: 'k0', label: turn.calls[0], status: 'running' }],
                    },
                  ]
                : [],
            },
          ],
        }));
      });

      let appliedChanges: ReturnType<typeof plan.applyEdit> = [];

      // Tool calls resolve one by one; the plan edit is committed as the last call completes.
      turn.calls.forEach((_, i) => {
        t += 800;
        const isLast = i === turn.calls.length - 1;
        at(t, () => {
          if (isLast && turn.edit) appliedChanges = plan.applyEdit(turn.edit);
          patchMessage(conversationId, replyId, (m) => ({
            ...m,
            parts: m.parts.map((p): MessagePart => {
              if (p.type !== 'activity') return p;
              const calls = p.calls.map((call, idx) =>
                idx === i ? { ...call, status: 'done' as const } : call,
              );
              if (!isLast) {
                calls.push({ id: `k${i + 1}`, label: turn.calls[i + 1], status: 'running' });
              }
              return {
                ...p,
                calls,
                seconds: isLast
                  ? Math.max(1, Math.round((Date.now() - started) / 1000))
                  : undefined,
              };
            }),
          }));
        });
      });

      // Stream the reply text in small chunks.
      t += 250;
      const chunk = 4;
      const steps = Math.ceil(turn.reply.length / chunk);
      at(t, () => {
        patchMessage(conversationId, replyId, (m) => ({
          ...m,
          parts: [...m.parts, { type: 'text', text: '' }],
        }));
      });
      for (let i = 1; i <= steps; i++) {
        t += 18;
        const upto = Math.min(turn.reply.length, i * chunk);
        at(t, () => {
          patchMessage(conversationId, replyId, (m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.type === 'text' && m.parts.indexOf(p) === m.parts.length - 1
                ? { ...p, text: turn.reply.slice(0, upto) }
                : p,
            ),
          }));
        });
      }

      t += 200;
      at(t, () => {
        const extra: MessagePart[] = [];
        if (appliedChanges.length) {
          extra.push({
            type: 'planUpdate',
            summary: turn.summary ?? `${appliedChanges.length} changes to the draft`,
            changes: appliedChanges,
          });
        }
        if (turn.unlockAction) {
          extra.push({ type: 'action', action: 'unlock', label: 'Unlock plan' });
        }
        patchMessage(conversationId, replyId, (m) => ({
          ...m,
          status: 'done',
          parts: [...m.parts, ...extra],
        }));
        patchConversation(conversationId, (c) => ({ ...c, run: 'idle' }));
        runs.current.delete(conversationId);
      });
    },
    [patchConversation, patchMessage, plan],
  );

  const cancel = useCallback(
    (conversationId: string) => {
      const handle = runs.current.get(conversationId);
      if (!handle) return;
      handle.timers.forEach(clearTimeout);
      runs.current.delete(conversationId);
      patchConversation(conversationId, (c) => {
        const exists = c.messages.some((m) => m.id === handle.messageId);
        return {
          ...c,
          run: 'idle',
          messages: c.messages
            .map((m) =>
              m.id === handle.messageId
                ? {
                    ...m,
                    status: 'stopped' as const,
                    parts: m.parts.map((p): MessagePart =>
                      p.type === 'activity'
                        ? {
                            ...p,
                            calls: p.calls.map((call) => ({ ...call, status: 'done' as const })),
                          }
                        : p,
                    ),
                  }
                : m,
            )
            .concat(
              exists
                ? []
                : [
                    {
                      id: handle.messageId,
                      role: 'assistant' as const,
                      createdAt: Date.now(),
                      status: 'stopped' as const,
                      parts: [],
                    },
                  ],
            ),
        };
      });
    },
    [patchConversation],
  );

  const createConversation = useCallback(() => {
    const conversation = newConversation();
    setConversations((prev) => [conversation, ...prev]);
    return conversation.id;
  }, []);

  const archive = useCallback(
    (id: string, archived: boolean) => patchConversation(id, (c) => ({ ...c, archived })),
    [patchConversation],
  );

  const markRead = useCallback(
    (id: string) => patchConversation(id, (c) => (c.unread ? { ...c, unread: false } : c)),
    [patchConversation],
  );

  const runUnlockAction = useCallback(
    (conversationId: string, messageId: string) => {
      plan.unlock();
      const version = plan.getSnapshot().version;
      patchConversation(conversationId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [
          ...c.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  parts: m.parts.map((p): MessagePart =>
                    p.type === 'action' ? { ...p, done: true } : p,
                  ),
                }
              : m,
          ),
          {
            id: newId('msg'),
            role: 'assistant' as const,
            createdAt: Date.now(),
            status: 'done' as const,
            parts: [
              {
                type: 'text' as const,
                text: `Draft v${version} is open for edits. What would you like to change?`,
              },
            ],
          },
        ],
      }));
    },
    [patchConversation, plan],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      getConversation: (id) => conversations.find((c) => c.id === id),
      createConversation,
      send,
      cancel,
      archive,
      markRead,
      runUnlockAction,
    }),
    [conversations, createConversation, send, cancel, archive, markRead, runUnlockAction],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}

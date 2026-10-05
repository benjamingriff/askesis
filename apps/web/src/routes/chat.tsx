import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarDays,
  Lock,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  PencilLine,
  TriangleAlert,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ChatRequestError, chatResult, isActive, type Target } from '../chat';
import { Composer, resize } from '../components/chat/Composer';
import { ConversationList } from '../components/chat/ConversationList';
import { ConversationPlanPanel } from '../components/chat/ConversationPlanPanel';
import { emptyTurn, type Turn } from '../components/chat/RunTurn';
import { Transcript } from '../components/chat/Transcript';
import { Button, Dialog, Menu, Notice, Tabs, cx } from '../components/ui';
import { readStorage, writeStorage } from '../lib/storage';
import { useLiveState } from '../live';
import { useDraftChanges, usePlan } from '../plan-data';

const PLAN_COLLAPSED_KEY = 'askesis-chat-plan-collapsed';
/** Chat and plan sit side by side from this width; below it they are tabs, as on mobile. */
const SPLIT_QUERY = '(min-width: 1450px)';
const PLAN_PANEL_ID = 'conversation-plan';
const CHAT_PANEL_ID = 'conversation-chat';

export function ChatPage({
  archived = false,
  composing = false,
}: {
  archived?: boolean | undefined;
  composing?: boolean | undefined;
}) {
  const { conversationId } = useParams();
  return (
    <ChatWorkspace
      key={conversationId ?? (archived ? 'archive' : 'new')}
      conversationId={conversationId}
      archived={archived}
      composing={composing}
    />
  );
}

function ChatWorkspace({
  conversationId,
  archived,
  composing,
}: {
  conversationId: string | undefined;
  archived: boolean;
  composing: boolean;
}) {
  // On narrow screens the list and the conversation are separate screens, like the mobile app.
  return (
    <div className={cx('chat-layout', (conversationId || composing) && 'has-conversation')}>
      <ConversationList archived={archived} activeId={conversationId} />
      {archived ? (
        <section className="chat-main chat-placeholder">
          <div className="chat-empty">
            <span className="empty-icon">
              <Archive size={22} aria-hidden="true" />
            </span>
            <h1>Conversation archive</h1>
            <p className="muted">Select a conversation to read it or restore it.</p>
          </div>
        </section>
      ) : (
        <ConversationPanel conversationId={conversationId} />
      )}
    </div>
  );
}

function ConversationPanel({ conversationId }: { conversationId: string | undefined }) {
  const live = useLiveState();
  const [workspaceView, setWorkspaceView] = useState<'chat' | 'plan'>('chat');
  const [planCollapsed, setPlanCollapsed] = useState(
    () => readStorage(PLAN_COLLAPSED_KEY) === 'true',
  );
  const following = useRef(true);
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { prefill?: string } | null)?.prefill;
  const [text, setText] = useState(prefill ?? '');
  const [target, setTarget] = useState<Target | undefined>(undefined);
  const [attempt, setAttempt] = useState<{ key: string; content: string; target: Target } | null>(
    null,
  );
  const [title, setTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [actionKey] = useState(() => crypto.randomUUID());
  const input = useRef<HTMLTextAreaElement>(null);
  const capabilities = useQuery({
    queryKey: ['chat', 'capabilities'],
    refetchInterval: 10000,
    queryFn: async () => chatResult(await api.GET('/api/v1/chat-capabilities')),
  });
  const detail = useQuery({
    queryKey: ['chat', 'detail', conversationId],
    enabled: !!conversationId,
    queryFn: async () =>
      chatResult(
        await api.GET('/api/v1/conversations/{conversationId}', {
          params: { path: { conversationId: conversationId! } },
        }),
      ),
  });
  const conversation = detail.data;
  const planId = conversation?.planId ?? null;
  const plan = usePlan(planId);
  const draftChanges = useDraftChanges(planId ?? '', (planId && plan.data?.draft) || null);
  const run = conversation?.activeRun ?? conversation?.latestRun;
  const history = useInfiniteQuery({
    queryKey: ['chat', 'messages', conversationId],
    enabled: !!conversationId,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      chatResult(
        await api.GET('/api/v1/conversations/{conversationId}/messages', {
          params: {
            path: { conversationId: conversationId! },
            query: { ...(pageParam === undefined ? {} : { beforeSequence: pageParam }) },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextBeforeSequence ?? undefined,
  });
  const messages = [
    ...new Map(
      history.data?.pages.flatMap((page) => page.messages).map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const earliestMessage = messages[0]?.sequence;
  const runs = useQuery({
    queryKey: ['chat', 'runs', conversationId, earliestMessage],
    enabled: !!conversationId,
    queryFn: async () => {
      const rows: Turn[] = [];
      let beforeSequence: number | undefined;
      do {
        const page = chatResult(
          await api.GET('/api/v1/conversations/{conversationId}/runs', {
            params: {
              path: { conversationId: conversationId! },
              query: { limit: 100, ...(beforeSequence ? { beforeSequence } : {}) },
            },
          }),
        );
        rows.push(...page.runs);
        beforeSequence = page.nextBeforeSequence ?? undefined;
      } while (beforeSequence && earliestMessage !== undefined && beforeSequence > earliestMessage);
      // Seed each turn's own cache; only working turns refetch it individually.
      for (const turn of rows) client.setQueryData(['chat', 'turn', turn.id], turn);
      return rows;
    },
  });
  const turns = new Map((runs.data ?? []).map((turn) => [turn.userMessageId, turn]));
  if (run && run.conversationId === conversationId)
    turns.set(run.userMessageId, { ...(turns.get(run.userMessageId) ?? emptyTurn(run)), ...run });

  // A coach shortcut that navigates here again (same conversation) fills the composer too.
  const [prefillKey, setPrefillKey] = useState(location.key);
  if (prefill && prefillKey !== location.key) {
    setPrefillKey(location.key);
    setText(prefill);
  }
  useEffect(() => {
    if (input.current) resize(input.current);
  }, [text]);

  const splitScreen = () => window.matchMedia?.(SPLIT_QUERY).matches ?? false;
  function openPlan() {
    // Side by side, the panel's visibility is a remembered preference; otherwise it is a tab.
    if (!splitScreen()) setWorkspaceView('plan');
    else if (planCollapsed) {
      setPlanCollapsed(false);
      writeStorage(PLAN_COLLAPSED_KEY, 'false');
    }
  }
  function closePlan() {
    setWorkspaceView('chat');
    setPlanCollapsed(true);
    writeStorage(PLAN_COLLAPSED_KEY, 'true');
  }
  function askCoach(prompt: string) {
    setText(prompt);
    setWorkspaceView('chat');
    requestAnimationFrame(() => {
      const node = input.current;
      node?.focus();
      node?.setSelectionRange(prompt.length, prompt.length);
    });
  }
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['chat'] });
  };
  const send = useMutation({
    mutationFn: async (request: { key: string; content: string; target: Target }) => {
      if (conversationId) {
        chatResult(
          await api.POST('/api/v1/conversations/{conversationId}/messages', {
            params: { path: { conversationId }, header: { 'idempotency-key': request.key } },
            body: { content: request.content, target: request.target },
          }),
        );
        return conversationId;
      }
      return chatResult(
        await api.POST('/api/v1/conversations', {
          params: { header: { 'idempotency-key': request.key } },
          body: { initialMessage: { content: request.content, target: null } },
        }),
      ).conversation.id;
    },
    onSuccess: (id) => {
      setAttempt(null);
      setText('');
      setTarget(undefined);
      void refresh();
      following.current = true;
      if (!conversationId) void navigate(`/chat/${id}`);
    },
    onError: (error) => {
      if (error instanceof ChatRequestError && error.status >= 400 && error.status < 500)
        setAttempt(null);
    },
  });
  const change = useMutation({
    mutationFn: async (action: 'rename' | 'archive' | 'unarchive' | 'new') => {
      if (!conversation) throw new Error('Load the conversation first.');
      const params = { path: { conversationId: conversation.id } };
      if (action === 'new') {
        const created = chatResult(
          await api.POST('/api/v1/conversations', {
            params: { header: { 'idempotency-key': actionKey } },
            body: { ...(conversation.planId ? { planId: conversation.planId } : {}) },
          }),
        );
        return created.conversation.id;
      }
      if (action === 'rename')
        chatResult(
          await api.PATCH('/api/v1/conversations/{conversationId}', {
            params,
            body: { title: title.trim(), expectedStateVersion: conversation.stateVersion },
          }),
        );
      else
        chatResult(
          await api.POST(`/api/v1/conversations/{conversationId}/${action}`, {
            params,
            body: { expectedStateVersion: conversation.stateVersion },
          }),
        );
      return null;
    },
    onSuccess: async (id) => {
      setRenaming(false);
      await refresh();
      if (id) void navigate(`/chat/${id}`);
    },
    onError: (_error, action) => {
      if (action === 'rename') void detail.refetch();
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (run)
        chatResult(
          await api.POST('/api/v1/agent-runs/{runId}/cancel', {
            params: { path: { runId: run.id } },
          }),
        );
    },
    onSuccess: refresh,
  });
  const running = isActive(run);
  // An uncertain send must remain retryable even when its accepted run is now active.
  const canSend =
    !send.isPending &&
    (!!attempt ||
      (!!capabilities.data?.executionAvailable &&
        !conversation?.archived &&
        !(conversationId && !conversation) &&
        !running));
  function submit() {
    if (!canSend || !text.trim()) return;
    const next = attempt ?? {
      key: crypto.randomUUID(),
      content: text.trim(),
      target: target ?? conversation?.context ?? null,
    };
    setAttempt(next);
    send.mutate(next);
  }
  const testMode = capabilities.data?.mode === 'test';
  const locked = conversation?.context?.state === 'locked';
  const subtitle = running
    ? 'Coach is working…'
    : planId
      ? locked
        ? `Locked v${conversation?.context?.versionNumber ?? ''} · unlock to edit`
        : 'Draft · coach can edit'
      : 'Standalone chat';
  const pendingChanges = draftChanges.data
    ? draftChanges.data.workouts.length + (draftChanges.data.omittedWorkouts ?? 0)
    : 0;
  const showPlan = !!planId && workspaceView === 'plan';

  return (
    <div
      className={cx(
        'conversation-workspace',
        planId && 'with-plan',
        planCollapsed && 'plan-collapsed',
        showPlan && 'show-plan',
      )}
    >
      <header className="chat-topbar">
        <Link to="/chat" className="chat-back" aria-label="All conversations">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div className="chat-heading">
          <h1>{conversation?.title ?? 'New conversation'}</h1>
          {conversationId ? (
            <span className="chat-subtitle">
              <i className={cx('status-dot', running ? 'running' : locked && 'locked')} />
              {subtitle}
            </span>
          ) : null}
        </div>
        {planId && conversation ? (
          <button
            type="button"
            onClick={openPlan}
            className="plan-chip"
            title="Review the plan this conversation edits"
            aria-label={`Review ${conversation.planName ?? 'plan'} beside the chat`}
          >
            {locked ? (
              <Lock size={13} aria-hidden="true" />
            ) : (
              <PencilLine size={13} aria-hidden="true" />
            )}
            <span>{conversation.planName}</span>
            <span className="plan-chip-state">{locked ? 'Locked' : 'Draft'}</span>
          </button>
        ) : null}
        {conversation ? (
          <Menu
            label="Conversation options"
            icon={MoreHorizontal}
            items={[
              {
                label: 'Rename conversation',
                icon: PencilLine,
                disabled: conversation.archived || change.isPending,
                onSelect: () => {
                  change.reset();
                  setTitle(conversation.title);
                  setRenaming(true);
                },
              },
              {
                label: conversation.planId ? 'New chat for this plan' : 'New standalone chat',
                icon: MessageSquarePlus,
                disabled: conversation.planArchived || change.isPending,
                onSelect: () => change.mutate('new'),
              },
              'divider',
              {
                label: conversation.archived ? 'Restore conversation' : 'Archive conversation',
                icon: conversation.archived ? ArchiveRestore : Archive,
                disabled: conversation.planArchived || change.isPending || running,
                onSelect: () => change.mutate(conversation.archived ? 'unarchive' : 'archive'),
              },
            ]}
          />
        ) : null}
      </header>
      {planId ? (
        <div className="conversation-view-tabs">
          <Tabs<'chat' | 'plan'>
            label="Conversation view"
            value={workspaceView}
            onChange={(next) => (next === 'plan' ? openPlan() : setWorkspaceView('chat'))}
            tabs={[
              { value: 'chat', label: 'Chat', icon: MessagesSquare, controls: CHAT_PANEL_ID },
              {
                value: 'plan',
                label: 'Plan',
                icon: CalendarDays,
                controls: PLAN_PANEL_ID,
                badge: pendingChanges,
              },
            ]}
          />
        </div>
      ) : null}
      <div className="conversation-body">
        <section className="chat-main" id={CHAT_PANEL_ID} aria-label="Chat">
          <div className="chat-notices">
            {live === 'reconnecting' && conversationId ? (
              <p className="live-connection muted" role="status">
                Reconnecting live updates…
                {running ? ' Your coach keeps working and saved changes are kept.' : ''}
              </p>
            ) : null}
            {(!renaming && change.error) || cancel.error ? (
              <Notice tone="danger" role="alert">
                {(!renaming && change.error?.message) || cancel.error?.message}
              </Notice>
            ) : null}
            {conversationId && detail.isPending ? (
              <p className="muted" role="status">
                Loading conversation…
              </p>
            ) : null}
            {detail.error ? (
              <Notice
                tone="danger"
                role="alert"
                action={
                  <Button size="sm" variant="ghost" onClick={() => void detail.refetch()}>
                    Retry
                  </Button>
                }
              >
                {detail.error.message}
              </Notice>
            ) : null}
            {conversation?.archived ? (
              <Notice
                icon={Archive}
                action={
                  conversation.planArchived ? (
                    <Link className="text-link" to={`/plans/${conversation.planId}`}>
                      Restore its plan to continue.
                    </Link>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => change.mutate('unarchive')}>
                      Restore conversation
                    </Button>
                  )
                }
              >
                This conversation is archived and read-only.
              </Notice>
            ) : null}
          </div>
          <Transcript
            conversationId={conversationId}
            conversation={conversation}
            messages={messages}
            turns={turns}
            otherRun={run && run.conversationId !== conversationId ? run : undefined}
            history={history}
            hidden={showPlan}
            followingRef={following}
            testMode={testMode}
            suggestionsDisabled={send.isPending || !!attempt}
            onSuggestion={(suggestion) => {
              setText(suggestion);
              input.current?.focus();
            }}
            onReview={planId ? openPlan : undefined}
          />
          <Composer
            input={input}
            text={text}
            onTextChange={(next) => {
              if (!text) setTarget(running ? undefined : (conversation?.context ?? null));
              setText(next);
            }}
            onSubmit={submit}
            placeholder={
              conversation?.context?.state === 'draft'
                ? 'Ask for a change, or just talk it through…'
                : 'Ask your coach anything…'
            }
            locked={!!attempt || send.isPending || !!conversation?.archived}
            canSend={canSend}
            sending={send.isPending}
            retrying={!!attempt}
            onStop={running && !attempt ? () => cancel.mutate() : undefined}
            stopping={cancel.isPending || run?.status === 'cancelling'}
            notices={
              <>
                {capabilities.data && !capabilities.data.executionAvailable ? (
                  <Notice tone="warning" icon={TriangleAlert}>
                    Coaching is not available yet. Your conversation history is still available.
                  </Notice>
                ) : null}
                {capabilities.error ? (
                  <Notice
                    tone="danger"
                    role="alert"
                    action={
                      <Button size="sm" variant="ghost" onClick={() => void capabilities.refetch()}>
                        Reconnect
                      </Button>
                    }
                  >
                    Could not connect to chat.
                  </Notice>
                ) : null}
                {capabilities.isPending ? (
                  <p className="muted" role="status">
                    Connecting to chat…
                  </p>
                ) : null}
              </>
            }
            footnote={
              <>
                {send.error ? (
                  <Notice
                    tone="danger"
                    role="alert"
                    action={
                      conversation?.planId && !attempt ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void detail.refetch().then((result) => {
                              setTarget(result.data?.context ?? null);
                              send.reset();
                            });
                          }}
                        >
                          Refresh context
                        </Button>
                      ) : undefined
                    }
                  >
                    {send.error.message}
                    {attempt ? ' Retry sends the same request safely.' : ''}
                  </Notice>
                ) : null}
                {testMode ? (
                  <details className="chat-footnote">
                    <summary>Test mode · replies are simulated</summary>
                    <p>
                      No coaching or plan changes yet. Try <code>/test slow</code> to test Stop,{' '}
                      <code>/test fail</code> for failure, or <code>/test timeout</code> for
                      timeout.
                    </p>
                  </details>
                ) : (
                  <p className="chat-footnote">
                    Your coach can edit drafts. Only you can confirm assumptions and lock a version.
                  </p>
                )}
              </>
            }
          />
        </section>
        {planId ? (
          <ConversationPlanPanel
            id={PLAN_PANEL_ID}
            planId={planId}
            onClose={closePlan}
            onAskCoach={askCoach}
          />
        ) : null}
      </div>
      <Dialog
        open={renaming}
        size="sm"
        busy={change.isPending}
        onClose={() => setRenaming(false)}
        title="Rename conversation"
        footer={
          <>
            <Button variant="ghost" disabled={change.isPending} onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="rename-conversation"
              disabled={!title.trim() || change.isPending}
            >
              Save
            </Button>
          </>
        }
      >
        <form
          id="rename-conversation"
          onSubmit={(e) => {
            e.preventDefault();
            if (!change.isPending) change.mutate('rename');
          }}
        >
          <label className="field">
            <span>Conversation title</span>
            <input
              autoFocus
              disabled={change.isPending}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {change.error ? (
            <Notice tone="danger" role="alert">
              {change.error.message}
            </Notice>
          ) : null}
        </form>
      </Dialog>
    </div>
  );
}

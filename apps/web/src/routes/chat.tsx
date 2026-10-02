import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Lock,
  MessageSquarePlus,
  MoreHorizontal,
  PencilLine,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ChatMarkdown } from '../components/ChatMarkdown';
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  Notice,
  ProgressBar,
  Segmented,
  cx,
} from '../components/ui';
import {
  ChatRequestError,
  chatResult,
  isActive,
  useConversations,
  type Conversation,
  type Run,
  type Target,
} from '../chat';
import { daysBetween, formatShort, relativeTime } from '../lib/format';
import { useSettings } from '../settings';

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1)
    if (predicate(items[index]!)) return index;
  return -1;
}

const SUGGESTIONS = [
  'Help me build a plan for my next race',
  'How should I pace my long run?',
  'I missed a session this week — what now?',
  'Explain my pace guides',
];

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

/** The Coach list: open and archived conversations, newest activity first. */
function ConversationList({
  archived,
  activeId,
}: {
  archived: boolean;
  activeId: string | undefined;
}) {
  const navigate = useNavigate();
  const list = useConversations(archived);
  const rows = [
    ...new Map(
      list.data?.pages.flatMap((page) => page.conversations).map((row) => [row.id, row]),
    ).values(),
  ];
  return (
    <aside className="conversation-list-panel" aria-label="Conversations">
      <div className="conversation-list-header">
        <h1>Coach</h1>
        <IconButton
          icon={MessageSquarePlus}
          label="New chat"
          tone="accent"
          onClick={() => void navigate('/chat/new')}
        />
      </div>
      <Segmented<'open' | 'archived'>
        label="Conversation collection"
        value={archived ? 'archived' : 'open'}
        onChange={(next) => void navigate(next === 'archived' ? '/chat/archive' : '/chat')}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      {list.isPending ? (
        <p className="muted" role="status">
          Loading conversations…
        </p>
      ) : null}
      {list.error ? (
        <Notice
          tone="danger"
          role="alert"
          action={
            <Button size="sm" variant="ghost" onClick={() => void list.refetch()}>
              Retry
            </Button>
          }
        >
          {list.error.message}
        </Notice>
      ) : null}
      {!list.isPending && !rows.length ? (
        <p className="muted conversation-empty">
          {archived ? 'Nothing archived.' : 'No conversations yet. Start one below.'}
        </p>
      ) : null}
      <nav className="conversation-list">
        {rows.map((row) => (
          <Link
            key={row.id}
            to={`/chat/${row.id}`}
            className={cx('conversation-row', row.id === activeId && 'active')}
            aria-current={row.id === activeId ? 'page' : undefined}
          >
            <span className="conversation-row-top">
              <strong>{row.title}</strong>
              <small>{relativeTime(row.activityAt)}</small>
            </span>
            <span className="conversation-row-meta">
              {row.planName ? (
                <>
                  <CalendarDays size={12} aria-hidden="true" /> {row.planName}
                </>
              ) : (
                'Standalone chat'
              )}
            </span>
          </Link>
        ))}
      </nav>
      {list.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={list.isFetchingNextPage}
          busy={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          More conversations
        </Button>
      ) : null}
    </aside>
  );
}

function ConversationPanel({ conversationId }: { conversationId: string | undefined }) {
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
  const scroller = useRef<HTMLDivElement>(null);
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
    refetchInterval: 2000,
  });
  const conversation = detail.data;
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
  useEffect(() => {
    if (conversationId)
      void client.invalidateQueries({ queryKey: ['chat', 'messages', conversationId] });
    void client.invalidateQueries({ queryKey: ['chat', 'list'] });
    void client.invalidateQueries({ queryKey: ['plans'] });
    void client.invalidateQueries({ queryKey: ['plan-workouts'] });
  }, [client, conversationId, run?.id, run?.status, conversation?.context?.editNumber]);
  const messages = [
    ...new Map(
      history.data?.pages.flatMap((page) => page.messages).map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const latestMessageId = messages.at(-1)?.id;
  useEffect(() => {
    // Scroll only the transcript, never the page around it.
    const node = scroller.current;
    node?.scrollTo?.({ top: node.scrollHeight, behavior: 'smooth' });
  }, [latestMessageId, run?.status]);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['chat'] });
  };
  const send = useMutation({
    mutationFn: async (input: { key: string; content: string; target: Target }) => {
      if (conversationId) {
        chatResult(
          await api.POST('/api/v1/conversations/{conversationId}/messages', {
            params: { path: { conversationId }, header: { 'idempotency-key': input.key } },
            body: { content: input.content, target: input.target },
          }),
        );
        return conversationId;
      }
      return chatResult(
        await api.POST('/api/v1/conversations', {
          params: { header: { 'idempotency-key': input.key } },
          body: { initialMessage: { content: input.content, target: null } },
        }),
      ).conversation.id;
    },
    onSuccess: (id) => {
      setAttempt(null);
      setText('');
      setTarget(undefined);
      if (input.current) input.current.style.height = 'auto';
      void refresh();
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
  // An uncertain send must remain retryable even when its accepted run is now active.
  const disabled =
    send.isPending ||
    (!attempt &&
      (!capabilities.data?.executionAvailable ||
        !!conversation?.archived ||
        (!!conversationId && !conversation) ||
        isActive(run)));
  function submit() {
    if (disabled || !text.trim()) return;
    const next = attempt ?? {
      key: crypto.randomUUID(),
      content: text.trim(),
      target: target ?? conversation?.context ?? null,
    };
    setAttempt(next);
    send.mutate(next);
  }
  const running = isActive(run);
  const testMode = capabilities.data?.mode === 'test';
  const subtitle = running
    ? 'Coach is working…'
    : conversation?.planId
      ? conversation.context?.state === 'draft'
        ? 'Draft · coach can edit'
        : `Locked v${conversation.context?.versionNumber ?? ''} · unlock to edit`
      : 'Standalone chat';
  const lastRunMessage = run
    ? findLastIndex(messages, (m) => m.producingRunId === run.id || m.id === run.userMessageId)
    : -1;

  return (
    <section className="chat-main">
      <header className="chat-topbar">
        <Link to="/chat" className="chat-back" aria-label="All conversations">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div className="chat-heading">
          <h1>{conversation?.title ?? 'New conversation'}</h1>
          {conversationId ? (
            <span className="chat-subtitle">
              <i
                className={cx(
                  'status-dot',
                  running ? 'running' : conversation?.context?.state === 'locked' && 'locked',
                )}
              />
              {subtitle}
            </span>
          ) : null}
        </div>
        {conversation?.planId ? (
          <Link
            to={`/plans/${conversation.planId}`}
            className="plan-chip"
            title="Open the plan this conversation edits"
          >
            {conversation.context?.state === 'locked' ? (
              <Lock size={13} aria-hidden="true" />
            ) : (
              <PencilLine size={13} aria-hidden="true" />
            )}
            <span>{conversation.planName}</span>
            <span className="plan-chip-state">
              {conversation.context?.state === 'draft' ? 'Draft' : 'Locked'}
            </span>
          </Link>
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
      <div className="chat-notices">
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
      <div ref={scroller} className={cx('message-scroll', messages.length === 0 && 'empty')}>
        {history.hasNextPage ? (
          <Button
            size="sm"
            variant="ghost"
            className="load-older"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Load older messages
          </Button>
        ) : null}
        {history.error ? (
          <Notice
            tone="danger"
            role="alert"
            action={
              <Button size="sm" variant="ghost" onClick={() => void history.refetch()}>
                Retry history
              </Button>
            }
          >
            {history.error.message}
          </Notice>
        ) : null}
        {!messages.length ? (
          <div className="chat-empty">
            <span className="coach-avatar large" aria-hidden="true">
              <Sparkles size={22} />
            </span>
            <h2>How can I help with your training?</h2>
            <p className="muted">
              {testMode
                ? 'Try a conversation. Your messages are saved, with simulated replies for now.'
                : 'Talk through your goals, your plan, your workouts and your week.'}
            </p>
            {!conversationId ? (
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="suggestion"
                    onClick={() => {
                      setText(suggestion);
                      input.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {messages.length > 0 ? (
          <div className="messages">
            {messages.map((message, index) => (
              <div key={message.id} className="message-group">
                <article className={`message ${message.role}`}>
                  {message.role === 'assistant' ? (
                    <span className="message-author">
                      <span className="coach-avatar" aria-hidden="true">
                        <Sparkles size={12} />
                      </span>
                      Askesis
                      {testMode ? <small> · test reply</small> : null}
                    </span>
                  ) : (
                    <span className="sr-only">You</span>
                  )}
                  {message.role === 'assistant' ? (
                    <ChatMarkdown content={message.content} />
                  ) : (
                    <p className="chat-text">{message.content}</p>
                  )}
                </article>
                {run && index === lastRunMessage ? (
                  <RunActivity run={run} conversation={conversation} />
                ) : null}
              </div>
            ))}
            {run && lastRunMessage === -1 ? (
              <RunActivity run={run} conversation={conversation} />
            ) : null}
          </div>
        ) : run ? (
          // A plan-wide run can belong to another chat; show it so Stop is never anonymous.
          <div className="messages">
            <RunActivity run={run} conversation={conversation} />
          </div>
        ) : null}
      </div>
      <div className="composer-wrap">
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
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={input}
            aria-label="Message"
            rows={1}
            maxLength={32000}
            value={text}
            disabled={!!attempt || send.isPending || !!conversation?.archived}
            onChange={(e) => {
              if (!text) setTarget(conversation?.context ?? null);
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              conversation?.context?.state === 'draft'
                ? 'Ask for a change, or just talk it through…'
                : 'Ask your coach anything…'
            }
          />
          {running && !attempt ? (
            <button
              type="button"
              className="composer-button stop"
              aria-label="Stop"
              title="Stop the coach. Changes already saved stay in the draft."
              disabled={cancel.isPending || run?.status === 'cancelling'}
              onClick={() => cancel.mutate()}
            >
              <Square size={13} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              className="composer-button send"
              aria-label={
                send.isPending ? 'Sending message' : attempt ? 'Retry send' : 'Send message'
              }
              title={send.isPending ? 'Sending…' : attempt ? 'Retry send' : 'Send message · Enter'}
              disabled={disabled || !text.trim()}
              type="submit"
            >
              {send.isPending ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <ArrowUp size={19} aria-hidden="true" />
              )}
            </button>
          )}
        </form>
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
              <code>/test fail</code> for failure, or <code>/test timeout</code> for timeout.
            </p>
          </details>
        ) : (
          <p className="chat-footnote">
            Your coach can edit drafts. Only you can confirm assumptions and lock a version.
          </p>
        )}
      </div>
    </section>
  );
}

const TOOL_LABELS: Record<string, { running: string; done: string; edits?: boolean }> = {
  read_plan_context: { running: 'Reading your plan', done: 'Read your plan' },
  read_schedule: { running: 'Reading the schedule', done: 'Read the schedule' },
  create_plan_draft: {
    running: 'Creating a plan draft',
    done: 'Created a plan draft',
    edits: true,
  },
  update_plan_brief: {
    running: 'Updating planning assumptions',
    done: 'Updated planning assumptions',
    edits: true,
  },
  set_fitness_calibration: { running: 'Setting pace guides', done: 'Set pace guides', edits: true },
  apply_schedule_changes: { running: 'Updating workouts', done: 'Updated workouts', edits: true },
  replace_schedule_range: {
    running: 'Writing the schedule',
    done: 'Wrote the schedule',
    edits: true,
  },
  validate_plan: { running: 'Checking the plan', done: 'Checked the plan' },
};

const RUN_LABELS: Record<Run['status'], string> = {
  queued: 'Queued',
  running: 'Working',
  cancelling: 'Stopping…',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * T3-style activity card for the latest run: what the coach is doing, what it changed, and any
 * schedule generation progress. Committed changes always stay saved, even after Stop.
 */
function RunActivity({ run, conversation }: { run: Run; conversation: Conversation | undefined }) {
  const { settings } = useSettings();
  const active = isActive(run);
  const [open, setOpen] = useState(false);
  const events = useQuery({
    queryKey: ['chat', 'events', run.id, run.status],
    refetchInterval: active ? 2000 : false,
    queryFn: async () =>
      chatResult(
        await api.GET('/api/v1/agent-runs/{runId}/events', { params: { path: { runId: run.id } } }),
      ),
  });
  const tools = (events.data?.events ?? [])
    .filter((event) => event.type === 'tool_completed')
    .map((event) => String(event.metadata.name ?? 'tool'));
  const edited = tools.some((name) => TOOL_LABELS[name]?.edits);
  const seconds =
    run.startedAt && run.finishedAt
      ? Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))
      : null;
  const generation = run.generation;
  const generationProgress =
    generation && generation.prescribedThrough
      ? Math.min(
          1,
          (daysBetween(generation.startDate, generation.prescribedThrough) + 1) /
            (daysBetween(generation.startDate, generation.endDate) + 1),
        )
      : 0;
  const latestTool = tools.at(-1);
  const summary = active
    ? run.status === 'running'
      ? latestTool
        ? `${RUN_LABELS.running} · ${TOOL_LABELS[latestTool]?.done ?? latestTool.replaceAll('_', ' ')}`
        : RUN_LABELS.running
      : RUN_LABELS[run.status]
    : `${RUN_LABELS[run.status]}${seconds ? ` · ${seconds}s` : ''}${tools.length ? ` · ${tools.length} ${tools.length === 1 ? 'action' : 'actions'}` : ''}`;
  const failure =
    run.failureCode === 'STALE_CONTEXT'
      ? 'The plan changed; refresh context before sending again.'
      : run.failureCode === 'EXECUTION_TIMEOUT'
        ? 'Execution timed out. You can send another message.'
        : run.failureCode
          ? 'Execution stopped. You can send another message.'
          : null;
  return (
    <div className={cx('run-activity', run.status)} role="status">
      <button
        type="button"
        className="run-summary"
        aria-expanded={open}
        disabled={!settings.showActivity || !tools.length}
        onClick={() => setOpen((value) => !value)}
      >
        {active ? (
          <Loader2 className="spin" size={15} aria-hidden="true" />
        ) : run.status === 'completed' ? (
          <Check size={15} aria-hidden="true" className="ok" />
        ) : (
          <TriangleAlert size={15} aria-hidden="true" className="warn" />
        )}
        <span>{summary}</span>
        {settings.showActivity && tools.length ? (
          open ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )
        ) : null}
      </button>
      {open && settings.showActivity ? (
        <ol className="run-steps">
          {tools.map((name, index) => (
            <li key={index}>
              <Check size={13} aria-hidden="true" />
              {TOOL_LABELS[name]?.done ?? name.replaceAll('_', ' ')}
            </li>
          ))}
        </ol>
      ) : null}
      {generation ? (
        <div className="generation">
          <div className="generation-copy">
            <CalendarDays size={14} aria-hidden="true" />
            <span>
              {generation.status === 'completed'
                ? 'Schedule generation completed.'
                : generation.status === 'interrupted'
                  ? 'Schedule generation remains unfinished.'
                  : 'Schedule generation in progress.'}{' '}
              Intended horizon {formatShort(generation.startDate)} –{' '}
              {formatShort(generation.endDate)}
              {generation.prescribedThrough
                ? ` · fully prescribed through ${formatShort(generation.prescribedThrough)}`
                : ''}
            </span>
          </div>
          <ProgressBar value={generationProgress} label="Schedule generation progress" />
        </div>
      ) : null}
      {failure ? <p className="run-note">{failure}</p> : null}
      {run.status === 'failed' || run.status === 'cancelled' ? (
        <p className="run-note">
          Completed plan changes remain saved; review your draft before continuing.
        </p>
      ) : null}
      {edited && !active && conversation?.planId && conversation.context?.state === 'draft' ? (
        <Link className="plan-update" to={`/plans/${conversation.planId}`}>
          <span className="callout-icon">
            <CalendarDays size={16} aria-hidden="true" />
          </span>
          <span>
            <strong>Plan draft updated</strong>
            <small>Review the changes, then lock when you’re happy.</small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      ) : null}
      {conversation && run.conversationId !== conversation.id ? (
        <p className="run-note">
          Running in <Link to={`/chat/${run.conversationId}`}>another chat for this plan</Link>
        </p>
      ) : null}
    </div>
  );
}

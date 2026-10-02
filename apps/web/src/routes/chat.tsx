import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Archive,
  Bot,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  Square,
} from 'lucide-react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
  ChatRequestError,
  chatResult,
  isActive,
  useConversations,
  type Conversation,
  type Run,
  type Target,
} from '../chat';

export function ChatPage({ archived = false }: { archived?: boolean }) {
  const { conversationId } = useParams();
  return (
    <ChatWorkspace
      key={conversationId ?? (archived ? 'archive' : 'new')}
      conversationId={conversationId}
      archived={archived}
    />
  );
}
function ChatWorkspace({
  conversationId,
  archived,
}: {
  conversationId: string | undefined;
  archived: boolean;
}) {
  const list = useConversations(archived);
  const [panelOpen, setPanelOpen] = useState(
    () => !window.matchMedia?.('(max-width: 720px)').matches,
  );
  const rows = [
    ...new Map(
      list.data?.pages.flatMap((page) => page.conversations).map((row) => [row.id, row]),
    ).values(),
  ];
  return (
    <div className={`chat-layout${panelOpen ? '' : ' context-closed'}`}>
      <aside className="chat-context-panel">
        <div className="context-header">
          <div>
            <span className="assistant-icon">
              <Sparkles size={17} />
            </span>
            <strong>Askesis coach</strong>
          </div>
          <button
            className="icon-button"
            aria-label="Hide conversations"
            onClick={() => setPanelOpen(false)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <Link className="new-chat-button" to="/chat">
          <Plus size={17} /> New conversation
        </Link>
        <Link className="chat-archive-link" to={archived ? '/chat' : '/chat/archive'}>
          <Archive size={14} /> {archived ? 'Open conversations' : 'Archived conversations'}
        </Link>
        <h2 className="conversation-heading">{archived ? 'Archive' : 'Conversations'}</h2>
        {list.isPending && <p role="status">Loading conversations…</p>}
        {list.error && (
          <p role="alert">
            {list.error.message} <button onClick={() => void list.refetch()}>Retry</button>
          </p>
        )}
        {!list.isPending && !rows.length && <p>No conversations yet.</p>}
        <nav className="conversation-list">
          {rows.map((row) => (
            <NavLink
              key={row.id}
              to={`/chat/${row.id}`}
              onClick={() => {
                if (window.matchMedia?.('(max-width: 720px)').matches) setPanelOpen(false);
              }}
            >
              <MessageCircle size={17} />
              <span>
                <strong>{row.title}</strong>
                <small>{row.planName ?? 'Standalone chat'}</small>
              </span>
            </NavLink>
          ))}
        </nav>
        {list.hasNextPage && (
          <button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            More conversations
          </button>
        )}
      </aside>
      {archived ? (
        <section className="chat-main">
          <button className="chat-panel-open" onClick={() => setPanelOpen(true)}>
            Show conversations
          </button>
          <div className="chat-empty-state">
            <h1>Conversation archive</h1>
            <p>Select a conversation to read it or restore it.</p>
          </div>
        </section>
      ) : (
        <ConversationPanel
          conversationId={conversationId}
          onShowConversations={() => setPanelOpen(true)}
        />
      )}
    </div>
  );
}

function ConversationPanel({
  conversationId,
  onShowConversations,
}: {
  conversationId: string | undefined;
  onShowConversations: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [target, setTarget] = useState<Target | undefined>(undefined);
  const [attempt, setAttempt] = useState<{ key: string; content: string; target: Target } | null>(
    null,
  );
  const [title, setTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [actionKey] = useState(() => crypto.randomUUID());
  const end = useRef<HTMLDivElement>(null);
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
    end.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [latestMessageId]);
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
  return (
    <section className="chat-main">
      <header className="chat-topbar">
        <button
          className="icon-button chat-panel-open"
          aria-label="Show conversations"
          onClick={onShowConversations}
        >
          <PanelLeftOpen size={19} />
        </button>
        <div className="chat-heading">
          <h1>{conversation?.title ?? 'Askesis coach'}</h1>
          {conversation?.planId && (
            <Link to={`/plans/${conversation.planId}`}>
              {conversation.planName}
              <span> · {conversation.context?.state === 'draft' ? 'Draft' : 'Locked'}</span>
            </Link>
          )}
        </div>
        {conversation && (
          <details className="chat-options">
            <summary className="icon-button" aria-label="Conversation options">
              <MoreHorizontal size={20} />
            </summary>
            <div className="chat-menu">
              <button
                disabled={conversation.archived || change.isPending}
                onClick={() => {
                  setTitle(conversation.title);
                  setRenaming(true);
                }}
              >
                Rename conversation
              </button>
              <button
                disabled={conversation.planArchived || change.isPending || isActive(run)}
                onClick={() => change.mutate(conversation.archived ? 'unarchive' : 'archive')}
              >
                {conversation.archived ? 'Restore conversation' : 'Archive conversation'}
              </button>
              <button
                disabled={conversation.planArchived || change.isPending}
                onClick={() => change.mutate('new')}
              >
                {conversation.planId ? 'New chat for this plan' : 'New standalone chat'}
              </button>
            </div>
          </details>
        )}
      </header>
      {renaming && (
        <form
          className="chat-rename"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate('rename');
          }}
        >
          <label>
            Conversation title
            <input
              autoFocus
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <button className="primary-button" disabled={!title.trim() || change.isPending}>
            Save
          </button>
          <button className="chat-text-button" type="button" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      )}
      {(change.error || cancel.error) && (
        <p className="chat-notice" role="alert">
          {change.error?.message ?? cancel.error?.message}
        </p>
      )}
      {conversationId && detail.isPending && (
        <p className="chat-notice" role="status">
          Loading conversation…
        </p>
      )}
      {detail.error && (
        <p className="chat-notice" role="alert">
          {detail.error.message} <button onClick={() => void detail.refetch()}>Retry</button>
        </p>
      )}
      {conversation?.archived && (
        <p className="chat-notice">
          This conversation is archived and read-only.{' '}
          {conversation.planArchived ? (
            <Link to={`/plans/${conversation.planId}`}>Restore its plan to continue.</Link>
          ) : (
            <button className="chat-text-button" onClick={() => change.mutate('unarchive')}>
              Restore conversation
            </button>
          )}
        </p>
      )}
      <div className={`message-scroll${messages.length === 0 ? ' empty' : ''}`}>
        {history.hasNextPage && (
          <button
            className="chat-load-more"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Load older messages
          </button>
        )}
        {history.error && (
          <p className="chat-notice" role="alert">
            {history.error.message}{' '}
            <button onClick={() => void history.refetch()}>Retry history</button>
          </p>
        )}
        {!messages.length && (
          <div className="chat-empty-state">
            <span className="empty-spark">
              <Sparkles size={24} />
            </span>
            <h2>How can I help with your training?</h2>
            <p>
              {capabilities.data?.mode === 'test'
                ? 'Try a conversation. Your messages are saved, with simulated replies for now.'
                : 'A space to talk about your plan, your workouts, and your week.'}
            </p>
          </div>
        )}
        {messages.length > 0 && (
          <div className="messages">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                {message.role === 'assistant' && (
                  <span className="message-avatar">
                    <Bot size={17} />
                  </span>
                )}
                <div>
                  <span className="message-author">
                    {message.role === 'user' ? 'You' : 'Askesis'}
                  </span>
                  <p className="chat-text">{message.content}</p>
                </div>
              </article>
            ))}
            <div ref={end} />
          </div>
        )}
      </div>
      <div className="composer-wrap">
        {run && (
          <div className="chat-run" role="status">
            <RunStatus run={run} conversation={conversation} />
            {isActive(run) && (
              <button
                className="chat-stop"
                disabled={cancel.isPending || run.status === 'cancelling'}
                onClick={() => cancel.mutate()}
              >
                <Square size={11} fill="currentColor" /> Stop
              </button>
            )}
            <RunEvents run={run} />
          </div>
        )}
        {capabilities.data && !capabilities.data.executionAvailable && (
          <p className="chat-notice">
            Coaching is not available yet. Your conversation history is still available.
          </p>
        )}
        {capabilities.error && (
          <p className="chat-notice" role="alert">
            Could not connect to chat.{' '}
            <button className="chat-text-button" onClick={() => void capabilities.refetch()}>
              Reconnect
            </button>
          </p>
        )}
        {capabilities.isPending && (
          <p className="chat-notice" role="status">
            Connecting to chat…
          </p>
        )}
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            aria-label="Message"
            rows={1}
            maxLength={32000}
            value={text}
            disabled={!!attempt || send.isPending || !!conversation?.archived}
            onChange={(e) => {
              if (!text) setTarget(conversation?.context ?? null);
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask anything about your training"
          />
          <button
            className="send-button"
            aria-label={
              send.isPending ? 'Sending message' : attempt ? 'Retry send' : 'Send message'
            }
            title={send.isPending ? 'Sending…' : attempt ? 'Retry send' : 'Send message · Enter'}
            disabled={disabled || !text.trim()}
            type="submit"
          >
            <ArrowUp size={19} />
          </button>
        </form>
        {send.error && (
          <p role="alert" className="chat-send-error">
            {send.error.message}
            {attempt ? ' Retry sends the same request safely.' : ''}
            {conversation?.planId && !attempt && (
              <button
                className="chat-text-button"
                onClick={() => {
                  void detail.refetch().then((result) => {
                    setTarget(result.data?.context ?? null);
                    send.reset();
                  });
                }}
              >
                Refresh context
              </button>
            )}
          </p>
        )}
        {capabilities.data?.mode === 'test' ? (
          <details className="chat-test-info">
            <summary>Test mode · replies are simulated</summary>
            <p>
              No coaching or plan changes yet. Try <code>/test slow</code> to test Stop,{' '}
              <code>/test fail</code> for failure, or <code>/test timeout</code> for timeout.
            </p>
          </details>
        ) : (
          <p>Your coach can update the draft. Review the plan before locking a version.</p>
        )}
      </div>
    </section>
  );
}
function RunStatus({ run, conversation }: { run: Run; conversation: Conversation | undefined }) {
  const labels = {
    queued: 'Queued',
    running: 'Working',
    cancelling: 'Stopping…',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return (
    <span>
      {labels[run.status]}
      {run.failureCode &&
        ` · ${run.failureCode === 'STALE_CONTEXT' ? 'The plan changed; refresh context before sending again.' : run.failureCode === 'EXECUTION_TIMEOUT' ? 'Execution timed out. You can send another message.' : 'Execution stopped. You can send another message.'}`}
      {(run.status === 'failed' || run.status === 'cancelled') &&
        ' · Completed plan changes remain saved; review your draft before continuing.'}
      {run.generation && (
        <>
          {' '}
          · Intended horizon: {run.generation.startDate} – {run.generation.endDate}
          {run.generation.status === 'completed'
            ? ' · Schedule generation completed.'
            : run.generation.status === 'interrupted'
              ? ' · Schedule generation remains unfinished.'
              : ' · Schedule generation in progress.'}
          {run.generation.prescribedThrough &&
            ` Fully prescribed through ${run.generation.prescribedThrough}.`}
        </>
      )}
      {conversation && run.conversationId !== conversation.id && (
        <>
          {' '}
          in <Link to={`/chat/${run.conversationId}`}>another chat for this plan</Link>
        </>
      )}
    </span>
  );
}
function RunEvents({ run }: { run: Run }) {
  const events = useQuery({
    queryKey: ['chat', 'events', run.id, run.status],
    refetchInterval: isActive(run) ? 2000 : false,
    queryFn: async () =>
      chatResult(
        await api.GET('/api/v1/agent-runs/{runId}/events', { params: { path: { runId: run.id } } }),
      ),
  });
  return (
    <details>
      <summary>Run activity</summary>
      {events.error ? (
        <p>{events.error.message}</p>
      ) : (
        <ol>
          {events.data?.events.map((event) => (
            <li key={event.sequence}>{event.type.replaceAll('_', ' ')}</li>
          ))}
        </ol>
      )}
    </details>
  );
}

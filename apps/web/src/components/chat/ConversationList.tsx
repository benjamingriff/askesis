import { CalendarDays, MessageSquarePlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useConversations } from '../../chat';
import { relativeTime } from '../../lib/format';
import { Button, IconButton, Notice, Segmented, cx } from '../ui';

/** The Coach list: open and archived conversations, newest activity first. */
export function ConversationList({
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

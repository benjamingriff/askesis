import { ArrowDown, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Conversation, Run } from '../../chat';
import { ChatMarkdown } from '../ChatMarkdown';
import { Button, Notice } from '../ui';
import { OtherChatRun, RunTurn, type Message, type Turn } from './RunTurn';

const SUGGESTIONS = [
  'Help me build a plan for my next race',
  'How should I pace my long run?',
  'I missed a session this week — what now?',
  'Explain my pace guides',
];
/** Within this distance of the bottom, new output keeps the reader at the latest text. */
const FOLLOW_PX = 96;

export type History = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  error: Error | null;
  refetch: () => Promise<unknown>;
};

/**
 * The conversation: user messages, each followed by its coaching turn. It follows new output
 * only while the reader is near the bottom, keeps its place when older messages load, and
 * restores the reading position when shown again after the Plan tab.
 */
export function Transcript({
  conversationId,
  conversation,
  messages,
  turns,
  otherRun,
  history,
  hidden,
  followingRef,
  testMode,
  suggestionsDisabled,
  onSuggestion,
  onReview,
}: {
  conversationId: string | undefined;
  conversation: Conversation | undefined;
  messages: Message[];
  /** Turns keyed by the user message that started them. */
  turns: Map<string, Turn>;
  /** A plan-wide run working from another chat, so Stop is never anonymous. */
  otherRun: Run | undefined;
  history: History;
  hidden: boolean;
  followingRef: RefObject<boolean>;
  testMode: boolean;
  suggestionsDisabled: boolean;
  onSuggestion: (text: string) => void;
  onReview?: (() => void) | undefined;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const [jump, setJump] = useState(false);
  const replies = new Map(
    messages.flatMap((m) =>
      m.role === 'assistant' && m.producingRunId ? [[m.producingRunId, m]] : [],
    ),
  );
  const shownInTurn = new Set(
    [...turns.values()].flatMap((turn) => {
      const reply = replies.get(turn.id);
      return reply ? [reply.id] : [];
    }),
  );
  const latestMessageId = messages.at(-1)?.id;
  const latestUser = [...messages].reverse().find((m) => m.role === 'user');
  const latestStatus = latestUser ? turns.get(latestUser.id)?.status : undefined;

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const update = () => {
      // A hidden transcript has no layout; it must not move or lose its place.
      if (!node.clientHeight) return;
      if (followingRef.current) node.scrollTo?.({ top: node.scrollHeight, behavior: 'auto' });
      else setJump(true);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    const content = node.querySelector('.messages');
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [latestMessageId, latestStatus, followingRef]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (hidden || !node) return;
    if (followingRef.current) node.scrollTop = node.scrollHeight;
    else node.scrollTop = position.current;
  }, [hidden, followingRef]);

  return (
    <div
      ref={scroller}
      className={messages.length === 0 && !otherRun ? 'message-scroll empty' : 'message-scroll'}
      onScroll={() => {
        const node = scroller.current;
        if (!node || !node.clientHeight) return;
        // Growth below the reader also fires scroll events; only scrolling up stops following.
        if (node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_PX)
          followingRef.current = true;
        else if (node.scrollTop < position.current) followingRef.current = false;
        position.current = node.scrollTop;
        if (followingRef.current) setJump(false);
      }}
    >
      {history.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          className="load-older"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            followingRef.current = false;
            const node = scroller.current;
            const anchor = node?.querySelector('.message-group');
            const top = anchor?.getBoundingClientRect().top;
            void history.fetchNextPage().then(() => {
              requestAnimationFrame(() => {
                if (node?.isConnected && anchor?.isConnected && top !== undefined)
                  node.scrollTop += anchor.getBoundingClientRect().top - top;
              });
            });
          }}
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
      {!messages.length && !otherRun ? (
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
                  disabled={suggestionsDisabled}
                  onClick={() => onSuggestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="messages">
          {messages.map((message) => {
            if (shownInTurn.has(message.id)) return null;
            const turn = message.role === 'user' ? turns.get(message.id) : undefined;
            return (
              <div key={message.id} className="message-group">
                {message.role === 'user' ? (
                  <article className="message user">
                    <span className="sr-only">You</span>
                    <p className="chat-text">{message.content}</p>
                  </article>
                ) : (
                  <article className="message assistant">
                    <span className="message-author">
                      <span className="coach-avatar" aria-hidden="true">
                        <Sparkles size={12} />
                      </span>
                      Askesis
                      {testMode ? <small>test reply</small> : null}
                    </span>
                    <ChatMarkdown content={message.content} />
                  </article>
                )}
                {turn ? (
                  <RunTurn
                    turn={turn}
                    reply={replies.get(turn.id)}
                    conversation={conversation}
                    testMode={testMode}
                    onReview={onReview}
                  />
                ) : null}
              </div>
            );
          })}
          {otherRun && conversation ? (
            <OtherChatRun run={otherRun} conversation={conversation} />
          ) : null}
        </div>
      )}
      {jump ? (
        <Button
          size="sm"
          icon={ArrowDown}
          className="jump-latest"
          onClick={() => {
            followingRef.current = true;
            setJump(false);
            const node = scroller.current;
            node?.scrollTo?.({ top: node.scrollHeight, behavior: 'smooth' });
          }}
        >
          Jump to latest
        </Button>
      ) : null}
    </div>
  );
}

import { ArrowUp, Loader2, Square } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

/**
 * Message input with Send and Stop. Typing stays available while the coach works; Send waits
 * for the run to finish under the single-run rule. Enter sends, Shift+Enter adds a line.
 */
export function Composer({
  input,
  text,
  onTextChange,
  onSubmit,
  placeholder,
  locked,
  canSend,
  sending,
  retrying,
  onStop,
  stopping,
  notices,
  footnote,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** The textarea is read-only while a send is in flight, retrying or archived. */
  locked: boolean;
  canSend: boolean;
  sending: boolean;
  retrying: boolean;
  /** Present while a run from this conversation can be stopped. */
  onStop?: (() => void) | undefined;
  stopping: boolean;
  notices?: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <div className="composer-wrap">
      {notices}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <textarea
          ref={input}
          aria-label="Message"
          rows={1}
          maxLength={32000}
          value={text}
          disabled={locked}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
        />
        {onStop ? (
          <button
            type="button"
            className="composer-button stop"
            aria-label="Stop"
            title="Stop the coach. Changes already saved stay in the draft."
            disabled={stopping}
            onClick={onStop}
          >
            <Square size={13} fill="currentColor" aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="composer-button send"
          aria-label={sending ? 'Sending message' : retrying ? 'Retry send' : 'Send message'}
          title={sending ? 'Sending…' : retrying ? 'Retry send' : 'Send message · Enter'}
          disabled={!canSend || !text.trim()}
          type="submit"
        >
          {sending ? (
            <Loader2 className="spin" size={18} aria-hidden="true" />
          ) : (
            <ArrowUp size={19} aria-hidden="true" />
          )}
        </button>
      </form>
      {footnote}
    </div>
  );
}

/** Grow with the text up to a few lines, and shrink back when it is cleared. */
export function resize(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto';
  if (textarea.value) textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
}

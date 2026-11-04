import { Check, Copy, MessageSquare } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { agentPrompt, useInAppCoach } from '../coach';
import { Button, ButtonLink, Dialog } from './ui';

const AskAgentContext = createContext<((prompt: string) => void) | null>(null);

const missingProvider = () => {
  throw new Error('Ask your agent needs an AskAgentProvider.');
};

/** Hands a prompt to the athlete's own agent: copies it and shows it to paste. */
export function useAskAgent() {
  return useContext(AskAgentContext) ?? missingProvider;
}

/**
 * Askesis cannot message the athlete's agent, so asking copies a prompt for them to paste. The
 * prompt stays visible, because the clipboard can refuse a write that follows a slow save.
 */
export function AskAgentProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);
  const ask = useCallback(
    (text: string) => {
      setPrompt(text);
      setCopied(null);
      void copy(text);
    },
    [copy],
  );
  const close = () => setPrompt(null);

  return (
    <AskAgentContext.Provider value={ask}>
      {children}
      <Dialog
        open={prompt !== null}
        onClose={close}
        size="md"
        className="ask-agent"
        title="Ask your agent"
        description="Paste this into Claude or the agent you connected to Askesis. Changes it saves appear here for you to review."
        footer={
          <>
            <Button
              variant="primary"
              icon={copied ? Check : Copy}
              onClick={() => prompt !== null && void copy(prompt)}
            >
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
            <Button onClick={close}>Done</Button>
          </>
        }
      >
        <textarea
          readOnly
          rows={5}
          value={prompt ?? ''}
          aria-label="Prompt for your agent"
          onFocus={(event) => event.currentTarget.select()}
        />
        <p className="muted" role="status">
          {copied === true
            ? 'Copied to your clipboard.'
            : copied === false
              ? 'Select the prompt and copy it, then paste it into your agent.'
              : null}
        </p>
      </Dialog>
    </AskAgentContext.Provider>
  );
}

const START_PLAN =
  'Help me build a training plan. List my plans first, then ask me about my goal, my dates and the training I do now.';

/** The primary way to start a plan: a chat with the in-app coach, or the athlete's own agent. */
export function StartPlanButton({ coachLabel }: { coachLabel: string }) {
  const coach = useInAppCoach();
  const askAgent = useAskAgent();
  if (coach)
    return (
      <ButtonLink to="/chat" variant="primary" icon={MessageSquare}>
        {coachLabel}
      </ButtonLink>
    );
  return (
    <Button
      variant="primary"
      icon={MessageSquare}
      onClick={() => askAgent(agentPrompt(START_PLAN))}
    >
      Ask your agent
    </Button>
  );
}

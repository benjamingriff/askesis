import type { PromptRecord } from '../../types';

const ROLE: Record<string, string> = {
  coach: 'Coach',
  simulator: 'Athlete simulator',
  voice: 'Athlete voice',
  reviewer: 'Plan reviewer',
  tools: 'Coach tools',
};

export function Prompts({ prompts }: { prompts: PromptRecord[] }) {
  return (
    <div className="prompt-list">
      {prompts.map((prompt) => (
        <details key={prompt.role} className="prompt-card">
          <summary>
            <span className="prompt-role">{ROLE[prompt.role] ?? prompt.role}</span>
            <span className="mono small">{prompt.name ?? 'unnamed'}</span>
            <span className="mono small muted" title={prompt.hash ?? undefined}>
              {prompt.hash ? prompt.hash.slice(0, 12) : 'no hash'}
            </span>
          </summary>
          {prompt.text === null ? (
            <p className="muted small">The text was not saved with this run.</p>
          ) : (
            <pre className="prompt-text">{prompt.text}</pre>
          )}
        </details>
      ))}
    </div>
  );
}

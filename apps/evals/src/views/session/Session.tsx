import { useState } from 'react';
import { Section } from '../../components/Section';
import { useRunDetail } from '../../lib/data';
import { demoRunDetail } from '../../lib/demo';
import { href } from '../../lib/route';
import type { RunDetail, RunSummary } from '../../types';
import { Assessment } from './Assessment';
import { BeliefLedger, DecisionLog, FactMatrix } from './Discovery';
import { PlanFitness } from './PlanFitness';
import { FlagList, Scorecard, SessionHeader } from './Summary';
import { Prompts } from './Prompts';
import { Timeline } from './Timeline';
import { TrainingLoad } from './TrainingLoad';
import { Transcript } from './Transcript';

export function Session({
  id,
  demo,
  color,
}: {
  id: string;
  demo: RunSummary | null;
  color: string | undefined;
}) {
  const load = useRunDetail(demo ? null : id);
  if (demo) return <SessionBody run={demoRunDetail(demo)} color={color} />;
  if (load.status === 'loading') return <div className="empty-state">Loading conversation…</div>;
  if (load.status === 'error') {
    return (
      <div className="empty-state">
        <h2>Conversation unavailable</h2>
        <p>{load.message}</p>
        <a href={href('conversations')}>Back to conversations</a>
      </div>
    );
  }
  return <SessionBody run={load.data} color={color} />;
}

function SessionBody({ run, color }: { run: RunDetail; color: string | undefined }) {
  const [selectedTurn, setSelectedTurn] = useState<number | null>(
    () => run.turns[0]?.index ?? null,
  );
  const stats = run.conversation;
  const onSelectRef = (ref: string) => {
    const [kind, value] = ref.split(':');
    if (kind === 'turn') setSelectedTurn(Number(value));
    if (kind === 'message') {
      const turn = run.turns.find((entry) => entry.replySequence === Number(value));
      if (turn) setSelectedTurn(turn.index);
    }
  };

  return (
    <div className="chart-feed session">
      <SessionHeader run={run} color={color} />
      <Scorecard run={run} />

      {run.scripted && (
        <div className="callout warn">
          <span>
            Scripted run: a fixture model exercised the harness. Nothing here grades real coaching
            quality.
          </span>
        </div>
      )}

      <Section
        id="flags"
        title="What to look at"
        description="Flags derived from the transcript, tool trace and saved plan. They point at evidence and are not verdicts."
      >
        <FlagList flags={run.flags} onSelectRef={onSelectRef} />
      </Section>

      {run.messages.length > 0 && (
        <Section
          id="timeline"
          title="Session timeline"
          description="Where the time went. Hover for detail; click a coach turn to inspect it below."
        >
          <Timeline
            run={run}
            selectedTurn={selectedTurn}
            onSelectTurn={(turn) => {
              setSelectedTurn(turn.index);
              const target = document.getElementById(
                turn.replySequence === null ? `turn-${turn.index}` : `msg-${turn.replySequence}`,
              );
              target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          />
        </Section>
      )}

      <Section
        id="transcript"
        title="Conversation"
        description="Athlete messages show the scenario facts they disclosed. Coach messages show cost, questions, tools and reviewer citations."
        aside={
          stats ? `${stats.athleteTurns} athlete · ${stats.coachTurns} coach turns` : undefined
        }
      >
        <Transcript run={run} selectedTurn={selectedTurn} onSelectTurn={setSelectedTurn} />
      </Section>

      <Section
        id="discovery"
        title="Discovery"
        description="Which scenario facts the athlete disclosed, and when. Required facts gate the benchmark's discovery check."
      >
        <FactMatrix run={run} onSelectRef={onSelectRef} />
      </Section>

      <Section
        id="beliefs"
        title="What the coach recorded"
        description="The saved brief, draft and fitness record compared with what the athlete actually said."
      >
        <BeliefLedger run={run} onSelectRef={onSelectRef} />
      </Section>

      <Section
        id="decisions"
        title="Decisions"
        description="Every write the coach made, in order, with field-level changes to the brief."
      >
        <DecisionLog run={run} onSelectRef={onSelectRef} />
      </Section>

      <Section
        id="plan"
        title="Plan fitness"
        description="The saved plan measured against the athlete's stated baseline, availability and limits."
      >
        <PlanFitness run={run} />
      </Section>

      <Section
        id="load"
        title="Training load"
        description="Time, distance and training stress of the saved prescriptions on one date axis, with fitness and fatigue seeded from the athlete's stated training."
      >
        <TrainingLoad load={run.load} />
      </Section>

      <Section
        id="assessment"
        title="Reviewer assessment"
        aside={
          run.reviewerModel ? `${run.reviewerModel} · ${run.reviewerVersion ?? ''}` : undefined
        }
      >
        <Assessment run={run} onSelectRef={onSelectRef} />
      </Section>

      {run.prompts.length > 0 && (
        <Section
          id="prompts"
          title="Prompts"
          description="The exact prompt texts this run used, with their version names and SHA-256 hashes."
        >
          <Prompts prompts={run.prompts} />
        </Section>
      )}
    </div>
  );
}

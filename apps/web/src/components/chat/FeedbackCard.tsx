import { HeartPulse, MessageSquare } from 'lucide-react';
import type { paths } from '@askesis/api-client';
import { LogChip } from '../TrainingLog';
import { LOG_LABELS, REASON_LABELS, effortFlag } from '../../training-log';
import { formatDuration, formatLong } from '../../lib/format';
type Message =
  paths['/api/v1/conversations/{conversationId}/messages']['get']['responses'][200]['content']['application/json']['messages'][number];
export function FeedbackCards({ references }: { references: Message['references'] }) {
  if (!references?.length) return null;
  return (
    <>
      {references.map((ref, index) =>
        ref.type === 'workout_log' ? (
          <div className="feedback-card" key={index}>
            <div className="feedback-card-header">
              <MessageSquare size={18} />
              <strong>Workout feedback</strong>
              <LogChip log={ref.snapshot} />
            </div>
            <p>
              <strong>{ref.snapshot.title}</strong> · {formatLong(ref.snapshot.performedOn)}
            </p>
            <p className="muted">
              {LOG_LABELS[ref.snapshot.status]}
              {ref.snapshot.actualDurationSeconds != null
                ? ` · ${formatDuration(ref.snapshot.actualDurationSeconds)}`
                : ''}
              {effortFlag(ref.snapshot) ? ` · ${effortFlag(ref.snapshot)}` : ''}
            </p>
            {ref.snapshot.reasons.length ? (
              <p>{ref.snapshot.reasons.map((r) => REASON_LABELS[r]).join(' · ')}</p>
            ) : null}
            <small className="muted">
              Saved feedback at the time of this message. Later corrections remain in your training
              log.
            </small>
          </div>
        ) : (
          <div className="feedback-card" key={index}>
            <div className="feedback-card-header">
              <HeartPulse size={18} />
              <strong>Not feeling 100%</strong>
            </div>
            <p>
              {
                (
                  {
                    ill: 'Feeling ill',
                    pain: 'Pain or injury',
                    run_down: 'Run down',
                    busy: 'Busy or travelling',
                  } as const
                )[ref.snapshot.kind]
              }{' '}
              · {formatLong(ref.snapshot.startsOn)}
              {ref.snapshot.endsOn
                ? ` to ${formatLong(ref.snapshot.endsOn)}`
                : ' · duration uncertain'}
            </p>
            <p className="muted">
              {
                (
                  {
                    easy: 'Easy sessions only',
                    shorter: 'Shorter sessions',
                    rest: 'Rest completely',
                    coach: 'Let my coach decide',
                  } as const
                )[ref.snapshot.details.preference]
              }{' '}
              · Return {ref.snapshot.details.returnStyle}
            </p>
            {ref.snapshot.details.note ? <p>{ref.snapshot.details.note}</p> : null}
          </div>
        ),
      )}
    </>
  );
}

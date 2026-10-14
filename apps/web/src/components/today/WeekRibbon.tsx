import type { WorkoutSummary } from '@askesis/api-client';
import { Check } from 'lucide-react';
import type { CSSProperties } from 'react';
import { dayNumber, formatDuration, formatLong, WEEKDAYS_SHORT } from '../../lib/format';
import { sessionLoad } from '../../lib/load';
import { workoutLook, workoutsOn } from '../../lib/workouts';
import { EFFORTS } from '../../theme/palette';
import { cx } from '../ui';

/** The hardest session sets a day's colour. */
function hardest(workouts: WorkoutSummary[]) {
  let best: ReturnType<typeof workoutLook> | null = null;
  for (const workout of workouts) {
    const look = workoutLook(workout);
    const rank = look.effort ? EFFORTS.indexOf(look.effort) : -1;
    const bestRank = best?.effort ? EFFORTS.indexOf(best.effort) : -1;
    if (!best || rank > bestRank) best = look;
  }
  return best;
}

/**
 * This week as a day picker shaped by load: each day's bar is its training load, coloured by its
 * hardest session. Days already behind you are ticked and dimmed.
 */
export function WeekRibbon({
  days,
  workouts,
  today,
  selected,
  onSelect,
}: {
  days: string[];
  workouts: WorkoutSummary[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const perDay = days.map((date) => {
    const items = workoutsOn(workouts, date);
    return {
      date,
      items,
      load: items.reduce((sum, w) => sum + sessionLoad(w), 0),
      seconds: items.reduce((sum, w) => sum + (w.estimatedDurationSeconds ?? 0), 0),
    };
  });
  const max = Math.max(...perDay.map((day) => day.load), 1);
  return (
    <div className="week-ribbon" role="group" aria-label="This week">
      {perDay.map((day, index) => {
        const look = hardest(day.items);
        const past = day.date < today;
        return (
          <button
            key={day.date}
            type="button"
            aria-pressed={day.date === selected}
            aria-label={formatLong(day.date)}
            aria-description={
              day.items.length ? day.items.map((w) => w.title).join(', ') : 'No session'
            }
            className={cx(
              'ribbon-day',
              day.date === selected && 'selected',
              day.date === today && 'today',
              past && 'past',
            )}
            onClick={() => onSelect(day.date)}
          >
            <span className="label">{WEEKDAYS_SHORT[index]!.slice(0, 1)}</span>
            <strong>{dayNumber(day.date)}</strong>
            <span className="ribbon-bar">
              <i
                style={
                  {
                    height: day.load ? `${Math.max(12, (day.load / max) * 100)}%` : '4px',
                    '--kind': look?.color ?? 'var(--border)',
                  } as CSSProperties
                }
              />
            </span>
            <small>
              {past && day.items.length ? (
                <Check size={11} aria-hidden="true" />
              ) : day.seconds ? (
                formatDuration(day.seconds).replace(' min', '′')
              ) : (
                'Rest'
              )}
            </small>
          </button>
        );
      })}
    </div>
  );
}

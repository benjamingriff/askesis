import type { WorkoutStep } from '@askesis/api-client';
import { useMemo } from 'react';
import { intensitySegments } from '../lib/workouts';

/** Effort profile: width is time, height is intensity, colour is the pace zone. */
export function IntensityChart({
  prescription,
  height = 56,
  dimmed,
}: {
  prescription: WorkoutStep;
  height?: number | undefined;
  dimmed?: boolean | undefined;
}) {
  const segments = useMemo(() => intensitySegments(prescription), [prescription]);
  if (!segments.length) return null;
  return (
    <div
      className={`intensity-chart${dimmed ? ' dimmed' : ''}`}
      style={{ height }}
      role="img"
      aria-label={`Effort profile with ${segments.length} segments`}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          title={segment.label}
          style={{
            flexGrow: segment.seconds,
            height: `${Math.min(100, 22 + segment.level * 15.6)}%`,
            background: segment.color,
          }}
        />
      ))}
    </div>
  );
}

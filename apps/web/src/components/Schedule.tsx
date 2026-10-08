import type { WorkoutSummary } from '@askesis/api-client';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  MessageSquare,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { useContext, useMemo, useState, type CSSProperties } from 'react';
import {
  addDays,
  dayNumber,
  formatDistance,
  formatDuration,
  formatLong,
  formatMonth,
  formatRange,
  formatShort,
  monthGrid,
  shiftMonth,
  WEEKDAYS_SHORT,
} from '../lib/format';
import {
  inferKind,
  volumeMeasure,
  isCovered,
  KIND_META,
  summarizeWeeks,
  workoutsOn,
  type CoverageRange,
} from '../lib/workouts';
import { coveringRange, isCutback as cutbackIn, type PlanBlock } from '../lib/blocks';
import type { TrainingWeek } from '@askesis/api-client';
import type { Units } from '../settings';
import { readStorage, writeStorage } from '../lib/storage';
import type { PlanVersion } from '../plan-data';
import { useFollowingState } from '../lib/use-following-state';
import { useWorkoutSelection, type WorkoutSelection } from '../lib/use-workout-selection';
import { WorkoutChangesContext } from './PlanChanges';
import { Stat, WeekChart } from './PlanWidgets';
import { DayRow, WorkoutCard, WorkoutDialog } from './Workout';
import { Button, Card, EmptyState, IconButton, Pill, Segmented, Notice, cx } from './ui';

type Mode = 'weeks' | 'calendar';
export type SchedulePresentation = 'interactive' | 'week-list';
const MODE_KEY = 'askesis-schedule-mode';

/** Runna-style schedule: weekly volume, a week at a time, or a month calendar. */
/** Calendar legend: the run kinds for running plans, plus each other sport present. */
function legendKinds(workouts: WorkoutSummary[]) {
  const present = new Set(workouts.map((workout) => inferKind(workout)));
  const base = ['easy', 'long', 'tempo', 'intervals', 'test'] as const;
  const extra = (['ride', 'swim', 'strength', 'mixed'] as const).filter((kind) =>
    present.has(kind),
  );
  const runs = workouts.some((workout) => workout.discipline === 'run');
  return [...(runs || !extra.length ? base : (['test'] as const)), ...extra];
}

export function Schedule({
  workouts,
  version,
  startDate,
  endDate,
  coverage,
  units,
  today,
  onAskCoach,
  onPlanRest,
  selection,
  presentation = 'interactive',
  blocks = [],
  storedWeeks = [],
}: {
  workouts: WorkoutSummary[];
  version?: Pick<PlanVersion, 'id' | 'editNumber'> | null | undefined;
  startDate: string | null;
  endDate: string | null;
  /** Recorded coverage, or null when unknown (see `knownCoverage`). */
  coverage: CoverageRange[] | null;
  units: Units;
  today: string;
  onAskCoach?: ((workout: WorkoutSummary) => void) | undefined;
  onPlanRest?: (() => void) | undefined;
  /** A parent that also opens workouts (for example from a change summary) owns selection. */
  selection?: WorkoutSelection | undefined;
  /** Library details retain weekly workout navigation without offering a calendar. */
  presentation?: SchedulePresentation | undefined;
  /** Labelled, phased blocks; empty for plans without phases. */
  blocks?: PlanBlock[] | undefined;
  /** The version's stored weeks, carrying the coach's cutback flags. */
  storedWeeks?: TrainingWeek[] | undefined;
}) {
  const weeks = useMemo(
    () => summarizeWeeks(workouts, startDate, endDate, coverage),
    [workouts, startDate, endDate, coverage],
  );
  const measure = volumeMeasure(workouts);
  const current = weeks.find((w) => today >= w.startDate && today <= w.endDate)?.number ?? null;
  const firstUpcoming =
    current ?? weeks.find((w) => w.endDate >= today)?.number ?? weeks.at(-1)?.number ?? 1;
  const [preferredMode, setMode] = useState<Mode>(() =>
    readStorage(MODE_KEY) === 'calendar' ? 'calendar' : 'weeks',
  );
  const mode = presentation === 'week-list' ? 'weeks' : preferredMode;
  const [selectedWeek, setSelectedWeek] = useFollowingState(firstUpcoming);
  const ownSelection = useWorkoutSelection(workouts, version?.id);
  const dialog = selection ?? ownSelection;
  const week = weeks.find((w) => w.number === selectedWeek) ?? weeks[0];
  const blockOf = (range: { startDate: string; endDate: string }) => coveringRange(blocks, range);
  const isCutback = (range: { startDate: string; endDate: string }) =>
    cutbackIn(storedWeeks, range);
  const weekBlock = week ? blockOf(week) : null;
  const dayStatus = (date: string) =>
    (startDate && date < startDate) || (endDate && date > endDate)
      ? ('outside' as const)
      : coverage && !isCovered(date, coverage)
        ? ('unplanned' as const)
        : ('planned' as const);

  if (!weeks.length || !week)
    return (
      <EmptyState icon={CalendarDays} title="No workouts scheduled yet" dashed>
        Your coach adds workouts as you plan together.
      </EmptyState>
    );

  return (
    <section className="schedule" aria-labelledby="schedule-heading">
      <div className="schedule-header">
        <h2 id="schedule-heading">Schedule</h2>
        {presentation === 'interactive' ? (
          <Segmented<Mode>
            label="Schedule view"
            value={mode}
            onChange={(next) => {
              setMode(next);
              writeStorage(MODE_KEY, next);
            }}
            options={[
              { value: 'weeks', label: 'Weeks', icon: List },
              { value: 'calendar', label: 'Calendar', icon: CalendarDays },
            ]}
          />
        ) : null}
      </div>

      {mode === 'weeks' ? (
        <>
          <Card className="week-chart-card">
            <WeekChart
              weeks={weeks}
              selected={week.number}
              current={current}
              onSelect={setSelectedWeek}
              units={units}
              measure={measure}
              blockOf={blocks.length ? blockOf : undefined}
              isCutback={storedWeeks.some((w) => w.cutback) ? isCutback : undefined}
            />
          </Card>
          <div className="week-heading">
            <div>
              <h3>
                Week {week.number}
                {weekBlock ? (
                  <span
                    className="pill phase-pill"
                    style={{ '--phase': weekBlock.color } as CSSProperties}
                    title={weekBlock.description ?? undefined}
                  >
                    {weekBlock.label}
                  </span>
                ) : null}
                {isCutback(week) ? (
                  <Pill
                    tone="neutral"
                    title="Deliberately lighter, so the training before it is absorbed."
                  >
                    Cutback
                  </Pill>
                ) : null}
                {week.number === current ? <Pill tone="accent">This week</Pill> : null}
              </h3>
              <span className="muted">
                {formatRange(week.startDate, week.endDate)}
                {weekBlock && weekBlock.title !== weekBlock.label ? ` · ${weekBlock.title}` : ''}
              </span>
            </div>
            <div className="week-nav">
              <IconButton
                icon={ChevronLeft}
                label="Previous week"
                tone="filled"
                disabled={week.number <= 1}
                onClick={() => setSelectedWeek(week.number - 1)}
              />
              <IconButton
                icon={ChevronRight}
                label="Next week"
                tone="filled"
                disabled={week.number >= weeks.length}
                onClick={() => setSelectedWeek(week.number + 1)}
              />
            </div>
          </div>
          {week.planned ? (
            <>
              <Card className="week-stats">
                {measure === 'distance' ? (
                  <Stat
                    label="Distance"
                    value={formatDistance(week.metres, units, false)}
                    unit={units}
                  />
                ) : null}
                <Stat label="Time" value={formatDuration(week.seconds)} />
                <Stat label="Sessions" value={String(week.workouts.length)} />
              </Card>
              <ol className="day-list">
                {Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i)).map((date) => (
                  <DayRow
                    key={date}
                    date={date}
                    today={today}
                    workouts={workoutsOn(week.workouts, date)}
                    status={dayStatus(date)}
                    units={units}
                    onOpen={dialog.open}
                  />
                ))}
              </ol>
            </>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="Not planned yet"
              dashed
              action={
                onPlanRest ? (
                  <Button variant="primary" icon={MessageSquare} onClick={onPlanRest}>
                    Plan it with your coach
                  </Button>
                ) : undefined
              }
            >
              Week {week.number} is inside your plan dates but hasn’t been prescribed yet. You can
              still lock what’s planned and extend it later from a new draft.
            </EmptyState>
          )}
        </>
      ) : (
        <CalendarView
          workouts={workouts}
          today={today}
          startDate={startDate}
          endDate={endDate}
          units={units}
          onOpen={dialog.open}
        />
      )}
      {dialog.missing ? (
        <Notice
          action={
            <Button size="sm" variant="ghost" onClick={dialog.close}>
              Back to schedule
            </Button>
          }
        >
          The workout you had open was removed from this draft.
        </Notice>
      ) : null}
      <WorkoutDialog
        workout={dialog.workout}
        version={version}
        units={units}
        onClose={dialog.close}
        onAskCoach={
          onAskCoach
            ? (workout) => {
                dialog.close();
                onAskCoach(workout);
              }
            : undefined
        }
      />
    </section>
  );
}

function CalendarView({
  workouts,
  today,
  startDate,
  endDate,
  units,
  onOpen,
}: {
  workouts: WorkoutSummary[];
  today: string;
  startDate: string | null;
  endDate: string | null;
  units: Units;
  onOpen: (workout: WorkoutSummary) => void;
}) {
  const initial =
    startDate && today < startDate ? startDate : endDate && today > endDate ? endDate : today;
  const [browsedMonth, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useFollowingState(initial);
  const month = browsedMonth ?? selected;
  const grid = useMemo(() => monthGrid(month), [month]);
  const inPlan = (date: string) =>
    (!startDate || date >= startDate) && (!endDate || date <= endDate);
  const selectedWorkouts = workoutsOn(workouts, selected);
  const changes = useContext(WorkoutChangesContext);
  const changed = (workout: WorkoutSummary) =>
    changes.some((change) => change.workoutId === workout.id);
  return (
    <Card className="calendar">
      <div className="calendar-header">
        <h3>{formatMonth(month)}</h3>
        <div className="week-nav">
          <IconButton
            icon={ChevronLeft}
            label="Previous month"
            tone="filled"
            onClick={() => setMonth(shiftMonth(month, -1))}
          />
          <IconButton
            icon={ChevronRight}
            label="Next month"
            tone="filled"
            onClick={() => setMonth(shiftMonth(month, 1))}
          />
        </div>
      </div>
      <div className="calendar-grid" role="grid" aria-label={formatMonth(month)}>
        {WEEKDAYS_SHORT.map((day) => (
          <span className="calendar-weekday" key={day} role="columnheader">
            {day.slice(0, 2)}
          </span>
        ))}
        {grid.flat().map((date) => {
          const items = workoutsOn(workouts, date);
          const outside = date.slice(0, 7) !== month.slice(0, 7);
          // Only goal races the coach marked carry the trophy.
          const isGoal = items.some((w) => w.racePriority === 'A');
          return (
            <button
              type="button"
              key={date}
              role="gridcell"
              aria-selected={date === selected}
              aria-label={`${formatLong(date)}${items.length ? `, ${items.map((w) => (changed(w) ? `${w.title} (changed in draft)` : w.title)).join(', ')}` : ''}`}
              className={cx(
                'calendar-day',
                outside && 'outside',
                !inPlan(date) && 'off-plan',
                date === today && 'today',
                date === selected && 'selected',
              )}
              onClick={() => setSelected(date)}
            >
              <span>{dayNumber(date)}</span>
              <span className="calendar-dots">
                {isGoal ? <Trophy size={11} aria-hidden="true" /> : null}
                {items.map((workout) => (
                  <i
                    key={workout.id}
                    className={changed(workout) ? 'changed' : undefined}
                    style={{ '--kind': KIND_META[inferKind(workout)].color } as CSSProperties}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        {legendKinds(workouts).map((key) => (
          <span key={key} style={{ '--kind': KIND_META[key].color } as CSSProperties}>
            <i /> {KIND_META[key].label}
          </span>
        ))}
      </div>
      <div className="calendar-selection">
        <span className="label">{formatLong(selected)}</span>
        {selectedWorkouts.length ? (
          selectedWorkouts.map((workout) => (
            <WorkoutCard key={workout.id} workout={workout} units={units} onOpen={onOpen} />
          ))
        ) : (
          <p className="muted">
            {inPlan(selected)
              ? `Nothing prescribed for ${formatShort(selected)}.`
              : 'Outside the plan dates.'}
          </p>
        )}
      </div>
    </Card>
  );
}

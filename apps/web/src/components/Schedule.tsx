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
import { useMemo, useState, type CSSProperties } from 'react';
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
  isCovered,
  KIND_META,
  summarizeWeeks,
  workoutsOn,
  type CoverageRange,
} from '../lib/workouts';
import type { Units } from '../settings';
import { readStorage, writeStorage } from '../lib/storage';
import type { PlanVersion } from '../plan-data';
import { useFollowingState } from '../lib/use-following-state';
import { useWorkoutSelection } from '../lib/use-workout-selection';
import { Stat, WeekChart } from './PlanWidgets';
import { DayRow, WorkoutCard, WorkoutDialog } from './Workout';
import { Button, Card, EmptyState, IconButton, Pill, Segmented, Notice, cx } from './ui';

type Mode = 'weeks' | 'calendar';
const MODE_KEY = 'askesis-schedule-mode';

/** Runna-style schedule: weekly volume, a week at a time, or a month calendar. */
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
}) {
  const weeks = useMemo(
    () => summarizeWeeks(workouts, startDate, endDate, coverage),
    [workouts, startDate, endDate, coverage],
  );
  const current = weeks.find((w) => today >= w.startDate && today <= w.endDate)?.number ?? null;
  const firstUpcoming =
    current ?? weeks.find((w) => w.endDate >= today)?.number ?? weeks.at(-1)?.number ?? 1;
  const [mode, setMode] = useState<Mode>(() =>
    readStorage(MODE_KEY) === 'calendar' ? 'calendar' : 'weeks',
  );
  const [selectedWeek, setSelectedWeek] = useFollowingState(firstUpcoming);
  const dialog = useWorkoutSelection(workouts, version?.id);
  const week = weeks.find((w) => w.number === selectedWeek) ?? weeks[0];
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
            />
          </Card>
          <div className="week-heading">
            <div>
              <h3>
                Week {week.number}
                {week.number === current ? <Pill tone="accent">This week</Pill> : null}
              </h3>
              <span className="muted">{formatRange(week.startDate, week.endDate)}</span>
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
                <Stat
                  label="Distance"
                  value={formatDistance(week.metres, units, false)}
                  unit={units}
                />
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
        <Notice>
          The selected workout was removed from this draft.{' '}
          <button className="link-button" type="button" onClick={dialog.close}>
            Dismiss
          </button>
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
          const isEnd = date === endDate;
          return (
            <button
              type="button"
              key={date}
              role="gridcell"
              aria-selected={date === selected}
              aria-label={`${formatLong(date)}${items.length ? `, ${items.map((w) => w.title).join(', ')}` : ''}`}
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
                {isEnd ? <Trophy size={11} aria-hidden="true" /> : null}
                {items.map((workout) => (
                  <i
                    key={workout.id}
                    style={{ '--kind': KIND_META[inferKind(workout)].color } as CSSProperties}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        {(['easy', 'long', 'tempo', 'intervals', 'test'] as const).map((key) => (
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

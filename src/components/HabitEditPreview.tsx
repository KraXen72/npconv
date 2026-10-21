import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
} from 'solid-js';
import type { ActivityGrid, CellClickDetail } from 'activity-grid';
import {
  MIN_NUMERIC_VALUE,
  NUMERIC_VALUE_SCALE,
  type HabitEdit,
  type HabitEditPlan,
} from '../converters/uhabits/editBackup';
import type { UHabitsHabit } from '../schemas/uhabits';
import { timestampToDayKey } from '../converters/stt-uhabits/uhabitsHelper';
import { scrollToLatestActivity } from './activityGraph';

interface Props {
  plan: HabitEditPlan;
  edit: HabitEdit;
}

const PREVIEW_VIEWS = [
  { value: 'source', label: 'Source' },
  { value: 'before', label: 'Before' },
  { value: 'result', label: 'Result' },
] as const;

type View = (typeof PREVIEW_VIEWS)[number]['value'];

const COLORS = {
  empty: '#1f232c',
  unknown: '#575653',
  zero: '#44405c',
  checked: '#3aa99f',
  skipped: '#a580e2',
  written: '#b7a5ee',
  numeric: ['#244c49', '#287a72', '#3aa99f', '#75d0c5'],
};

function valueLabel(value: number, habit: UHabitsHabit): string {
  if (value < 0) return 'Unknown';
  if (habit.type === 1) {
    const amount = value / NUMERIC_VALUE_SCALE;
    return habit.unit ? `${amount} ${habit.unit}` : String(amount);
  }

  switch (value) {
    case 2:
      return 'Checked';
    case 3:
      return 'Skipped';
    case 1:
      return 'Automatic';
    default:
      return 'Unchecked';
  }
}

/** Keep boolean colors fixed and numerical intensity relative to the goal, rather than the dataset maximum. */
function valueColor(value: number, habit: UHabitsHabit): string {
  if (value < 0) return COLORS.unknown;
  if (habit.type === 0) {
    if (value === 2) return COLORS.checked;
    if (value === 3 || value === 1) return COLORS.skipped;
    return COLORS.zero;
  }
  if (value === 0) return COLORS.zero;

  const amount = value / NUMERIC_VALUE_SCALE;
  const goal = Math.max(habit.target_value, MIN_NUMERIC_VALUE);
  const level = Math.ceil((amount / goal) * COLORS.numeric.length) - 1;
  const colorIndex = Math.min(COLORS.numeric.length - 1, Math.max(0, level));
  return COLORS.numeric[colorIndex];
}

/** Preview the planned result and original histories, including exact per-day values and notes. */
export const HabitEditPreview: Component<Props> = (props) => {
  const [view, setView] = createSignal<View>('result');
  const [year, setYear] = createSignal(new Date().getUTCFullYear());
  const [selectedDay, setSelectedDay] = createSignal('');
  let grid: ActivityGrid | undefined;
  let lastSelectionKey = '';
  let lastPositionKey = '';

  const allDates = createMemo(() => {
    const histories = [...props.plan.sourceHistory, ...props.plan.before];
    return new Set(histories.map((row) => timestampToDayKey(row.timestamp)));
  });
  const years = createMemo(() => {
    let first = Infinity;
    let last = -Infinity;
    for (const date of allDates()) {
      const entryYear = Number(date.slice(0, 4));
      first = Math.min(first, entryYear);
      last = Math.max(last, entryYear);
    }

    const currentYear = new Date().getUTCFullYear();
    return allDates().size ? { first, last } : { first: currentYear, last: currentYear };
  });
  const selectionKey = () => {
    const edit = props.edit;
    const range = edit.kind === 'change-type' ? '' : `${edit.range.start}:${edit.range.end}`;
    return `${edit.kind}:${props.plan.source.id}:${props.plan.target.id}:${range}`;
  };

  createEffect(() => {
    const key = selectionKey();
    if (key === lastSelectionKey) return;

    const latestWrite = props.plan.writes.reduce(
      (latest, row) => Math.max(latest, row.timestamp),
      -Infinity
    );
    const latestYear = Number.isFinite(latestWrite)
      ? new Date(latestWrite).getUTCFullYear()
      : years().last;

    lastSelectionKey = key;
    setYear(latestYear);
    setView('result');
    setSelectedDay('');
  });

  const displayedHistory = createMemo(() => {
    const plan = props.plan;
    switch (view()) {
      case 'source':
        return { habit: plan.source, entries: plan.sourceHistory };
      case 'before':
        return { habit: plan.target, entries: plan.before };
      case 'result':
        return { habit: plan.resultHabit, entries: plan.after };
    }
  });
  const entriesByDay = createMemo(
    () => new Map(displayedHistory().entries.map((row) => [timestampToDayKey(row.timestamp), row]))
  );
  const writtenDays = createMemo(
    () => new Set(props.plan.writes.map((row) => timestampToDayKey(row.timestamp)))
  );

  const dayDescription = (date: string) => {
    const row = entriesByDay().get(date);
    const parts = [date, row ? valueLabel(row.value, displayedHistory().habit) : 'No entry'];
    if (view() === 'result' && row) parts.push(writtenDays().has(date) ? 'Written' : 'Kept');
    if (row?.notes) parts.push(row.notes);

    return parts.join(' · ');
  };

  const decorateCells = (element: ActivityGrid) => {
    const entries = entriesByDay();
    const habit = displayedHistory().habit;
    const writes = writtenDays();
    const isResult = view() === 'result';

    // the package has no per-cell color callback; set state colors and safe text attributes after rendering
    element.shadowRoot?.querySelectorAll<HTMLElement>('.cell[data-date]').forEach((cell) => {
      const date = cell.dataset.date;
      if (!date) return;

      const row = entries.get(date);
      const isWritten = isResult && writes.has(date);
      cell.style.backgroundColor = row ? valueColor(row.value, habit) : COLORS.empty;
      cell.style.boxShadow = isWritten ? `inset 0 0 0 1px ${COLORS.written}` : '';
      cell.dataset.value = row ? String(row.value) : '';
      cell.dataset.written = String(isWritten);
      cell.title = dayDescription(date);
    });
  };

  createEffect(() => {
    const entries = entriesByDay();
    const displayYear = year();
    if (!grid) return;

    grid.emptyColor = COLORS.empty;
    grid.data = [...entries].map(([date, row]) => ({ date, count: Math.max(0, row.value) }));
    grid.startDate = `${displayYear}-01-01`;
    grid.endDate = `${displayYear}-12-31`;
    decorateCells(grid);

    const positionKey = `${selectionKey()}:${displayYear}`;
    if (positionKey !== lastPositionKey) {
      lastPositionKey = positionKey;
      scrollToLatestActivity(grid, allDates(), displayYear);
    }
  });

  const legend = () => {
    if (displayedHistory().habit.type === 0) {
      return [
        { label: 'Checked', color: COLORS.checked },
        { label: 'Unchecked', color: COLORS.zero },
        { label: 'Skipped / auto', color: COLORS.skipped },
        { label: 'Unknown', color: COLORS.unknown },
      ];
    }

    const amountLevels = COLORS.numeric.map((color, index) => ({
      label: index === COLORS.numeric.length - 1 ? 'Goal+' : '',
      color,
    }));
    return [
      { label: '0', color: COLORS.zero },
      ...amountLevels,
      { label: 'Unknown', color: COLORS.unknown },
    ];
  };

  const selectDay = (event: Event) => {
    const { date } = (event as CustomEvent<CellClickDetail>).detail;
    setSelectedDay(date);
  };
  const attachGrid = (element: ActivityGrid) => {
    grid = element;
    element.addEventListener('cell-click', selectDay);
  };
  onCleanup(() => grid?.removeEventListener('cell-click', selectDay));

  const availableViews = () =>
    PREVIEW_VIEWS.filter(
      (option) => option.value !== 'before' || props.edit.kind !== 'change-type'
    );
  const selectView = (nextView: View) => {
    setView(nextView);
    setSelectedDay('');
  };

  return (
    <section class="edit-preview" aria-label="Live habit preview">
      <div class="preview-toolbar">
        <div class="preview-tabs" role="group" aria-label="Preview history">
          <For each={availableViews()}>
            {(option) => (
              <button
                type="button"
                aria-pressed={view() === option.value}
                onClick={() => selectView(option.value)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
        <div class="grid-year-nav">
          <button
            type="button"
            aria-label="Previous year"
            disabled={year() <= years().first}
            onClick={() => setYear(year() - 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>
          <span class="grid-year-display">{year()}</span>
          <button
            type="button"
            aria-label="Next year"
            disabled={year() >= years().last}
            onClick={() => setYear(year() + 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>
        </div>
      </div>
      <div class="preview-heading">
        <span>{displayedHistory().habit.name}</span>
        <span>
          {props.plan.writes.length} written · {props.plan.preserved} kept
        </span>
      </div>
      <div class="activity-grid-container">
        <activity-grid ref={attachGrid} start-week-on-monday dark-mode class="habit-preview-grid" />
      </div>
      <div class="preview-legend" aria-label="Preview legend">
        <For each={legend()}>
          {(item) => (
            <span>
              <i style={{ background: item.color }} />
              {item.label}
            </span>
          )}
        </For>
        <span>
          <i class="written-swatch" />
          Written
        </span>
      </div>
      <Show when={selectedDay()}>
        <output class="preview-day-detail">{dayDescription(selectedDay())}</output>
      </Show>
    </section>
  );
};

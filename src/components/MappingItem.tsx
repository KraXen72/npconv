import { createSignal, createEffect, createMemo, onMount, onCleanup, untrack, type Component, type JSX, Show, For } from 'solid-js';
import type { ParsedSttBackup } from '../schemas/stt';
import type { ParsedTimeJotBackup } from '../schemas/timejot';
import type { ConversionMapping, ParsedUHabitsBackup, UHabitsHabit } from '../schemas/uhabits';
import { timestampToDayKey } from '../converters/stt-uhabits/uhabitsHelper';
import { invertTimeJotDays, timeJotDayKey } from '../converters/timejot-uhabits/timejotParser';

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      'activity-grid': any;
    }
  }
}

export type HabitSourceKind = 'stt' | 'timejot';

type GraphCategory = 'source' | 'existing' | 'overlap';

interface GridDataPoint {
  date: string;
  count: number;
}

const GRAPH_COLORS: Record<GraphCategory, string> = {
  source: '#00d1b2',
  existing: '#9474CC',
  overlap: '#e1c4ff'
};

const GRAPH_DIM_COLORS: Record<GraphCategory, string> = {
  source: '#123b38',
  existing: '#362b45',
  overlap: '#4b3f56'
};

const GRAPH_BASE_COLORS = ['#161b22', '#2a2a33', '#34313d', '#3c3845', '#45404f'];

function categoryForCount(count: number): GraphCategory | null {
  if (count === 1) return 'source';
  if (count === 2) return 'existing';
  if (count === 3) return 'overlap';
  return null;
}

/**
 * Apply semantic category colors after activity-grid renders its cells.
 *
 * activity-grid calculates each cell's level against the largest count in the
 * current data set. That makes a source-only or existing-only cell change
 * shade when rollover changes the maximum count. The package exposes the
 * count on each cell but not a per-cell color callback, so the final semantic
 * colors are applied to its open shadow DOM instead.
 */
function applyGraphCellColors(grid: any, focused: GraphCategory | null): void {
  const shadowRoot = grid?.shadowRoot as ShadowRoot | undefined;
  if (!shadowRoot) return;

  shadowRoot.querySelectorAll<HTMLElement>('.cell[data-count]').forEach(cell => {
    const category = categoryForCount(Number(cell.getAttribute('data-count')));
    if (!category) return;
    cell.style.backgroundColor = focused && focused !== category
      ? GRAPH_DIM_COLORS[category]
      : GRAPH_COLORS[category];
  });
}

interface Props {
  mappingId: number;
  sourceKind: HabitSourceKind;
  sttData: ParsedSttBackup | null;
  timeJotData: ParsedTimeJotBackup | null;
  uhabitsData: ParsedUHabitsBackup | null;
  onRemove: () => void;
  onChange: () => void;
  ref?: (api: { getMapping: () => ConversionMapping | null }) => void;
}

export const MappingItem: Component<Props> = (props) => {
  const [sourceId, setSourceId] = createSignal('');
  const [uhabitsHabitId, setUhabitsHabitId] = createSignal('');
  const [minDuration, setMinDuration] = createSignal(5);
  const [copySourceNotes, setCopySourceNotes] = createSignal(false);
  const [invertTimeJot, setInvertTimeJot] = createSignal(false);
  const [timeJotRolloverHours, setTimeJotRolloverHours] = createSignal(0);
  const [numericValue, setNumericValue] = createSignal(1);
  const [currentYear, setCurrentYear] = createSignal(new Date().getFullYear());
  const [showGrid, setShowGrid] = createSignal(false);
  const [yearInitialized, setYearInitialized] = createSignal(false);
  const [gridData, setGridData] = createSignal<GridDataPoint[]>([]);
  const [lockedCategory, setLockedCategory] = createSignal<GraphCategory | null>(null);
  const [hoveredLegendCategory, setHoveredLegendCategory] = createSignal<GraphCategory | null>(null);
  const activeCategory = createMemo(() => hoveredLegendCategory() ?? lockedCategory());

  const legendItems: Array<{ category: GraphCategory; label: () => string; title: string }> = [
    {
      category: 'source',
      label: () => `${props.sourceKind === 'timejot' ? 'TimeJot' : 'STT'} only`,
      title: 'Highlight days from the source backup'
    },
    {
      category: 'existing',
      label: () => 'uHabits only',
      title: 'Highlight days already in the uHabits backup'
    },
    {
      category: 'overlap',
      label: () => 'Both backups',
      title: 'Highlight days present in both backups'
    }
  ];

  let gridRef: any;

  const sourceOptions = createMemo(() => {
    if (props.sourceKind === 'timejot') {
      return [...(props.timeJotData?.events.values() ?? [])].map(event => ({
        id: event.id,
        label: event.title,
        archived: Boolean(event.archived)
      }));
    }

    return [...(props.sttData?.recordTypes.values() ?? [])].map(type => ({
      id: type.id,
      label: `${type.emoji} ${type.name}`.trim(),
      archived: false
    }));
  });

  const uhabitsOptions = createMemo(() => {
    const active: UHabitsHabit[] = [];
    const archived: UHabitsHabit[] = [];

    for (const habit of props.uhabitsData?.allHabits.values() ?? []) {
      if (habit.archived) archived.push(habit);
      else active.push(habit);
    }

    return { active, archived };
  });

  const selectedHabit = createMemo(() => {
    const id = Number(uhabitsHabitId());
    return props.uhabitsData?.allHabits.get(id) ?? null;
  });

  const targetDays = createMemo(() => {
    const targetId = Number(uhabitsHabitId());
    if (uhabitsHabitId() === '' || !Number.isInteger(targetId)) return new Set<string>();

    return new Set(
      props.uhabitsData?.repetitions
        .filter(repetition => repetition.habit_id === targetId)
        .map(repetition => timestampToDayKey(repetition.timestamp)) ?? []
    );
  });

  const sourceDays = createMemo(() => {
    const selected = Number(sourceId());
    if (sourceId() === '' || !Number.isInteger(selected)) return new Set<string>();

    if (props.sourceKind === 'timejot') {
      const recordedDays = new Set(
        props.timeJotData?.entries
          .filter(entry => entry.eventId === selected)
          .map(entry => timeJotDayKey(entry.date, timeJotRolloverHours())) ?? []
      );

      return invertTimeJot() && selectedHabit()?.type === 0
        ? invertTimeJotDays(recordedDays, targetDays())
        : recordedDays;
    }

    const minimumMs = minDuration() * 60 * 1000;
    return new Set(
      props.sttData?.records
        .filter(record => record.type_id === selected && record.end_timestamp - record.start_timestamp >= minimumMs)
        .map(record => new Date(record.start_timestamp).toISOString().slice(0, 10)) ?? []
    );
  });

  const updateGrid = () => {
    if (sourceId() === '' || uhabitsHabitId() === '' || !props.uhabitsData) {
      setShowGrid(false);
      return;
    }

    setShowGrid(true);

    const incoming = sourceDays();
    const existing = targetDays();

    const allDates = new Set([...incoming, ...existing]);
    const data = [...allDates].sort().map(date => ({
      date,
      count: incoming.has(date) && existing.has(date) ? 3 : incoming.has(date) ? 1 : 2
    }));

    setGridData(data);

    if (!yearInitialized() && data.length > 0) {
      setCurrentYear(Number(data[data.length - 1].date.slice(0, 4)));
      setYearInitialized(true);
    }
  };

  createEffect(() => {
    sourceId();
    uhabitsHabitId();
    minDuration();
    invertTimeJot();
    timeJotRolloverHours();
    props.sttData;
    props.timeJotData;
    props.uhabitsData;
    updateGrid();
  });

  createEffect(() => {
    const supportsInversion = props.sourceKind === 'timejot' && selectedHabit()?.type === 0;
    if (!supportsInversion && invertTimeJot()) setInvertTimeJot(false);
  });

  createEffect(() => {
    const isVisible = showGrid();
    const allData = [...gridData()].sort((a, b) => a.date.localeCompare(b.date));
    const displayYear = currentYear();
    
    if (gridRef && isVisible) {
      gridRef.data = allData;
      gridRef.endDate = `${displayYear}-12-31`;
      gridRef.startDate = `${displayYear}-01-01`;
      applyGraphCellColors(gridRef, untrack(activeCategory));
    }
  });

  createEffect(() => {
    const isVisible = showGrid();
    const focused = activeCategory();

    if (gridRef && isVisible) {
      applyGraphCellColors(gridRef, focused);
    }
  });

  createEffect(() => {
    sourceId();
    uhabitsHabitId();
    minDuration();
    copySourceNotes();
    invertTimeJot();
    timeJotRolloverHours();
    numericValue();
    queueMicrotask(props.onChange);
  });

  const clearCategoryFocus = () => {
    setLockedCategory(null);
    setHoveredLegendCategory(null);
  };

  const prevYear = () => {
    clearCategoryFocus();
    setCurrentYear(currentYear() - 1);
  };

  const nextYear = () => {
    clearCategoryFocus();
    setCurrentYear(currentYear() + 1);
  };

  const getMapping = (): ConversionMapping | null => {
    const source = Number(sourceId());
    const target = Number(uhabitsHabitId());
    if (sourceId() === '' || uhabitsHabitId() === '' || !Number.isInteger(source) || !Number.isInteger(target)) return null;

    const sourceExists = props.sourceKind === 'timejot'
      ? props.timeJotData?.events.has(source)
      : props.sttData?.recordTypes.has(source);
    const targetHabit = props.uhabitsData?.allHabits.get(target);
    if (!sourceExists || !targetHabit || (targetHabit.type !== 0 && targetHabit.type !== 1)) return null;

    const minimumDuration = minDuration();
    if (props.sourceKind === 'stt' && (!Number.isFinite(minimumDuration) || minimumDuration < 0)) return null;

    const value = numericValue();
    if (targetHabit.type === 1 && (!Number.isFinite(value) || value <= 0)) return null;

    return {
      sourceId: source,
      uhabitsHabitId: target,
      minDuration: props.sourceKind === 'stt' ? minimumDuration : 0,
      copySourceNotes: copySourceNotes(),
      invertTimeJot: props.sourceKind === 'timejot' && targetHabit.type === 0 ? invertTimeJot() : undefined,
      timeJotRolloverHours: props.sourceKind === 'timejot' ? timeJotRolloverHours() : undefined,
      numericValue: targetHabit.type === 1 ? value : undefined
    };
  };

  onMount(() => {
    props.ref?.({ getMapping });
  });

  const handleSourceChange: JSX.EventHandler<HTMLSelectElement, Event> = (e) => {
    setSourceId(e.currentTarget.value);
  };

  const handleUhabitsChange: JSX.EventHandler<HTMLSelectElement, Event> = (e) => {
    setUhabitsHabitId(e.currentTarget.value);
  };

  let removeGridClickListener: (() => void) | undefined;

  const attachGridClickListener = (grid: any) => {
    removeGridClickListener?.();

    const handleGridClick = (event: Event) => {
      const category = categoryForCount(Number((event as CustomEvent<{ count: number }>).detail?.count));
      if (!category) return;

      event.stopPropagation();
      setHoveredLegendCategory(null);
      setLockedCategory(category);
    };

    grid.addEventListener('cell-click', handleGridClick);

    removeGridClickListener = () => {
      grid.removeEventListener('cell-click', handleGridClick);
      removeGridClickListener = undefined;
    };
  };

  onCleanup(() => {
    removeGridClickListener?.();
    props.ref?.(null as any);
  });

  return (
    <div
      class="mapping-item"
      data-mapping-id={props.mappingId}
      onClick={clearCategoryFocus}
      onKeyDown={(event) => {
        if (event.key === 'Escape') clearCategoryFocus();
      }}
    >
      <div class="mapping-selects">
        <select
          class="stt-activity-select"
          data-mapping-id={props.mappingId}
          value={sourceId()}
          onChange={handleSourceChange}
        >
          <option value="">{props.sourceKind === 'timejot' ? 'Select TimeJot event...' : 'Select STT activity...'}</option>
          <For each={sourceOptions()}>
            {(opt) => (
              <option value={opt.id.toString()}>
                {opt.label}{opt.archived ? ' (archived)' : ''} (id: {opt.id})
              </option>
            )}
          </For>
        </select>

        <span class="mapping-arrow">▶</span>

        <select
          class="uhabits-habit-select"
          data-mapping-id={props.mappingId}
          value={uhabitsHabitId()}
          onChange={handleUhabitsChange}
        >
          <option value="">Select uHabits habit...</option>
          <For each={uhabitsOptions().active}>
            {(habit) => (
              <option value={habit.id.toString()}>
                {habit.name}{habit.type === 1 ? ` [numeric${habit.unit ? `: ${habit.unit}` : ''}]` : ''} (id: {habit.id})
              </option>
            )}
          </For>
          <Show when={uhabitsOptions().archived.length > 0}>
            <option disabled style={{ color: '#888' }}>
              ─── Archived ───
            </option>
            <For each={uhabitsOptions().archived}>
              {(habit) => (
                <option value={habit.id.toString()} style={{ 'font-style': 'italic', opacity: '0.7' }}>
                  {habit.name}{habit.type === 1 ? ` [numeric${habit.unit ? `: ${habit.unit}` : ''}]` : ''} (id: {habit.id})
                </option>
              )}
            </For>
          </Show>
        </select>

        <button class="remove-button remove-mapping" aria-label="Remove mapping" onClick={props.onRemove}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="mapping-options">
        <Show when={props.sourceKind === 'stt'}>
          <label class="option-item">
            <span class="option-label">Min duration:</span>
            <input
              type="number"
              class="min-duration-input"
              value={minDuration()}
              min="0"
              step="1"
              title="Minimum duration in minutes"
              onChange={(e) => setMinDuration(parseInt(e.currentTarget.value) || 0)}
            />
            <span class="option-unit">min</span>
          </label>
        </Show>

        <Show when={selectedHabit()?.type === 1}>
          <label class="option-item">
            <span class="option-label">Value per source day:</span>
            <input
              type="number"
              class="min-duration-input"
              value={numericValue()}
              min="0.001"
              step="0.001"
              title="Value added for each source day"
              onChange={(e) => setNumericValue(Number(e.currentTarget.value))}
            />
            <span class="option-unit">{selectedHabit()?.unit || 'units'}</span>
          </label>
        </Show>

        <label class="option-item option-checkbox" title="Copy source notes/comments to repetition notes">
          <input
            type="checkbox"
            class="copy-stt-comments-checkbox"
            checked={copySourceNotes()}
            onChange={(e) => setCopySourceNotes(e.currentTarget.checked)}
          />
          <span class="option-label">Copy {props.sourceKind === 'timejot' ? 'notes' : 'comments'}</span>
        </label>

        <Show when={props.sourceKind === 'timejot' && selectedHabit()}>
          <label class="option-item" title="Count TimeJot entries during the first hours after midnight toward the previous calendar day">
            <span class="option-label">After-midnight buffer:</span>
            <input
              type="number"
              class="min-duration-input"
              value={timeJotRolloverHours()}
              min="0"
              max="12"
              step="1"
              title="Hours after midnight to count toward the previous day; 0 disables this"
              onChange={(e) => setTimeJotRolloverHours(Math.max(0, Math.min(12, parseInt(e.currentTarget.value, 10) || 0)))}
            />
            <span class="option-unit">hours</span>
          </label>
        </Show>

        <Show when={props.sourceKind === 'timejot' && selectedHabit()?.type === 0}>
          <label class="option-item option-checkbox" title="Create repetitions in the largest uHabits tracking gap that contains this TimeJot event, excluding days with an entry">
            <input
              type="checkbox"
              class="invert-timejot-checkbox"
              checked={invertTimeJot()}
              onChange={(e) => setInvertTimeJot(e.currentTarget.checked)}
            />
            <span class="option-label">Invert TimeJot entries (fill missing days)</span>
          </label>
        </Show>
      </div>

      <Show when={showGrid()}>
        <div class="activity-grid-container">
          <div class="grid-year-nav">
            <button class="year-prev" data-mapping-id={props.mappingId} title="Previous year" onClick={prevYear}>
              ◀
            </button>
            <span class="grid-year-display">{currentYear()}</span>
            <button class="year-next" data-mapping-id={props.mappingId} title="Next year" onClick={nextYear}>
              ▶
            </button>
          </div>
          <activity-grid
            ref={(element: any) => {
              gridRef = element;
              if (element) {
                element.colors = GRAPH_BASE_COLORS;
                attachGridClickListener(element);
                applyGraphCellColors(element, untrack(activeCategory));
              } else {
                removeGridClickListener?.();
              }
            }}
            start-week-on-monday
            class="habit-preview-grid"
            dark-mode
          />
          <div class="activity-legend" role="group" aria-label="Activity graph legend">
            <span class="activity-legend-title">Legend</span>
            <For each={legendItems}>
              {(item) => (
                <button
                  type="button"
                  class="activity-legend-item"
                  classList={{
                    'is-focused': activeCategory() === item.category,
                    'is-dimmed': activeCategory() !== null && activeCategory() !== item.category
                  }}
                  aria-pressed={lockedCategory() === item.category}
                  title={item.title}
                  onPointerEnter={() => setHoveredLegendCategory(item.category)}
                  onPointerLeave={() => setHoveredLegendCategory(null)}
                  onFocus={() => setHoveredLegendCategory(item.category)}
                  onBlur={() => setHoveredLegendCategory(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setHoveredLegendCategory(null);
                    setLockedCategory(item.category);
                  }}
                >
                  <span class="activity-legend-swatch" style={{ 'background-color': GRAPH_COLORS[item.category] }} aria-hidden="true" />
                  {item.label()}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

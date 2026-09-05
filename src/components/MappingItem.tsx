import { createSignal, createEffect, createMemo, onMount, onCleanup, type Component, type JSX, Show, For } from 'solid-js';
import type { ParsedSttBackup } from '../schemas/stt';
import type { ParsedTimeJotBackup } from '../schemas/timejot';
import type { ConversionMapping, ParsedUHabitsBackup, UHabitsHabit } from '../schemas/uhabits';
import { timestampToDayKey } from '../converters/stt-uhabits/uhabitsHelper';

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

function categoryForCount(count: number): GraphCategory | null {
  if (count === 1) return 'source';
  if (count === 2) return 'existing';
  if (count === 3) return 'overlap';
  return null;
}

/**
 * Build the five-color palette expected by activity-grid while keeping the
 * source categories distinct even when one category is absent from the data.
 */
function getGraphColors(data: GridDataPoint[], focused: GraphCategory | null): string[] {
  const colors = ['#161b22', '#2a2a33', '#34313d', '#34313d', '#34313d'];
  const maxCount = Math.max(...data.map(day => day.count), 0);
  if (maxCount === 0) return colors;

  for (const day of data) {
    const category = categoryForCount(day.count);
    if (!category) continue;

    const level = Math.ceil(day.count / maxCount * (colors.length - 1));
    colors[level] = focused && focused !== category
      ? GRAPH_DIM_COLORS[category]
      : GRAPH_COLORS[category];
  }

  return colors;
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

  const sourceDays = createMemo(() => {
    const selected = Number(sourceId());
    if (sourceId() === '' || !Number.isInteger(selected)) return new Set<string>();

    if (props.sourceKind === 'timejot') {
      return new Set(
        props.timeJotData?.entries
          .filter(entry => entry.eventId === selected)
          .map(entry => entry.dayKey) ?? []
      );
    }

    const minimumMs = minDuration() * 60 * 1000;
    return new Set(
      props.sttData?.records
        .filter(record => record.type_id === selected && record.end_timestamp - record.start_timestamp >= minimumMs)
        .map(record => new Date(record.start_timestamp).toISOString().slice(0, 10)) ?? []
    );
  });

  const updateGrid = () => {
    const targetId = Number(uhabitsHabitId());
    if (sourceId() === '' || uhabitsHabitId() === '' || !props.uhabitsData) {
      setShowGrid(false);
      return;
    }

    setShowGrid(true);

    const incoming = sourceDays();
    const existing = new Set(
      props.uhabitsData.repetitions
        .filter(rep => rep.habit_id === targetId)
        .map(rep => timestampToDayKey(rep.timestamp))
    );

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
    props.sttData;
    props.timeJotData;
    props.uhabitsData;
    updateGrid();
  });

  createEffect(() => {
    const isVisible = showGrid();
    const allData = [...gridData()].sort((a, b) => a.date.localeCompare(b.date));
    const displayYear = currentYear();
    
    if (gridRef && isVisible) {
      gridRef.data = allData;
      gridRef.endDate = `${displayYear}-12-31`;
      gridRef.startDate = `${displayYear}-01-01`;
    }
  });

  createEffect(() => {
    const isVisible = showGrid();
    const focused = activeCategory();

    if (gridRef && isVisible) {
      gridRef.colors = getGraphColors(gridData(), focused);
    }
  });

  createEffect(() => {
    sourceId();
    uhabitsHabitId();
    minDuration();
    copySourceNotes();
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

    const shadowRoot = grid?.shadowRoot as ShadowRoot | undefined;
    if (!shadowRoot) return;

    // activity-grid renders cells in an open shadow root but has no click API.
    // Delegating here keeps the integration local without changing the package.
    const getCellCategory = (target: EventTarget | null): GraphCategory | null => {
      if (!(target instanceof Element)) return null;
      const cell = target.closest('.cell');
      return categoryForCount(Number(cell?.getAttribute('data-count')));
    };

    const handleGridClick = (event: Event) => {
      const category = getCellCategory(event.target);
      if (!category) return;

      event.stopPropagation();
      setHoveredLegendCategory(null);
      setLockedCategory(category);
    };

    shadowRoot.addEventListener('click', handleGridClick);

    removeGridClickListener = () => {
      shadowRoot.removeEventListener('click', handleGridClick);
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
                element.colors = getGraphColors(gridData(), activeCategory());
                attachGridClickListener(element);
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

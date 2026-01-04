import { createSignal, createEffect, createMemo, onMount, onCleanup, type Component, type JSX, Show, For } from 'solid-js';
import type { ParsedSttBackup, SttRecord } from '../types/stt';
import type { ParsedUHabitsBackup } from '../types/uhabits';

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      'activity-grid': any;
    }
  }
}

interface MappingResult {
  sttTypeId: number;
  uhabitsHabitId: number;
  minDuration: number;
  copySttComments: boolean;
}

interface Props {
  mappingId: number;
  sttData: ParsedSttBackup | null;
  uhabitsData: ParsedUHabitsBackup | null;
  onRemove: () => void;
  ref?: (api: { getMapping: () => MappingResult | null }) => void;
}

export const MappingItem: Component<Props> = (props) => {
  const [sttTypeId, setSttTypeId] = createSignal('');
  const [uhabitsHabitId, setUhabitsHabitId] = createSignal('');
  const [minDuration, setMinDuration] = createSignal(5);
  const [copySttComments, setCopySttComments] = createSignal(false);
  const [currentYear, setCurrentYear] = createSignal(new Date().getFullYear());
  const [showGrid, setShowGrid] = createSignal(false);
  const [yearInitialized, setYearInitialized] = createSignal(false);
  const [gridData, setGridData] = createSignal<any[]>([]);

  let gridRef: any;

  // Memoized sorted grid data
  const sortedGridData = createMemo(() => {
    const data = gridData();
    return [...data].sort((a, b) => a.date.localeCompare(b.date));
  });

  const handleSttChange: JSX.EventHandler<HTMLSelectElement, Event> = (e) => {
    setSttTypeId(e.currentTarget.value);
    updateGrid();
  };

  const handleUhabitsChange: JSX.EventHandler<HTMLSelectElement, Event> = (e) => {
    setUhabitsHabitId(e.currentTarget.value);
    updateGrid();
  };

  const handleMinDurationChange: JSX.EventHandler<HTMLInputElement, Event> = (e) => {
    setMinDuration(parseInt(e.currentTarget.value) || 0);
    updateGrid();
  };

  const updateGrid = () => {
    const sttId = parseInt(sttTypeId());
    const uhabitsId = parseInt(uhabitsHabitId());

    if (!sttId || !uhabitsId || !props.sttData || !props.uhabitsData) {
      setShowGrid(false);
      return;
    }

    setShowGrid(true);

    // Get existing repetitions
    const existingDates = new Set<string>();
    const existingData: any[] = [];

    for (const rep of props.uhabitsData.repetitions) {
      if (rep.habit_id === uhabitsId && rep.value > 0) {
        const date = new Date(rep.timestamp).toISOString().split('T')[0];
        existingDates.add(date);
        existingData.push({ date, count: 2 });
      }
    }

    // Get new repetitions from STT
    const filteredRecords = props.sttData.records.filter((r: SttRecord) => r.end_timestamp - r.start_timestamp >= minDuration() * 60 * 1000);
    const typeRecords = filteredRecords.filter((r: SttRecord) => r.type_id === sttId);
    const dayGroups = new Map<string, any[]>();

    for (const record of typeRecords) {
      const dayStart = new Date(record.start_timestamp);
      dayStart.setHours(0, 0, 0, 0);
      const dayStr = dayStart.toISOString().split('T')[0];
      if (!dayGroups.has(dayStr)) dayGroups.set(dayStr, []);
      dayGroups.get(dayStr)!.push(record);
    }

    const newData: any[] = [];
    for (const [dayStr] of dayGroups) {
      if (!existingDates.has(dayStr)) {
        newData.push({ date: dayStr, count: 1 });
      }
    }

    // Store grid data in signal
    setGridData([...existingData, ...newData]);

    // Initialize year once based on data
    if (!yearInitialized() && (existingData.length > 0 || newData.length > 0)) {
      const allDates = [...existingData.map(d => d.date), ...newData.map(d => d.date)];
      allDates.sort();
      const lastDate = allDates[allDates.length - 1];
      const lastYear = new Date(lastDate).getFullYear();
      setCurrentYear(lastYear);
      setYearInitialized(true);
    }
  };

  // Effect to update grid data when it changes
  createEffect(() => {
    const isVisible = showGrid();
    const allData = sortedGridData();
    const displayYear = currentYear();
    
    if (gridRef && isVisible) {
      const startDate = `${displayYear}-01-01`;
      const endDate = `${displayYear}-12-31`;
      
      // Set in this exact order: data first, then endDate, then startDate
      // This matches the working vanilla JS implementation
      gridRef.data = allData;
      gridRef.endDate = endDate;
      gridRef.startDate = startDate;
    }
  });

  const prevYear = () => {
    setCurrentYear(currentYear() - 1);
  };

  const nextYear = () => {
    setCurrentYear(currentYear() + 1);
  };

  // Expose data for parent to access
  const getMapping = (): MappingResult | null => {
    const sttId = parseInt(sttTypeId());
    const uhabitsId = parseInt(uhabitsHabitId());
    if (!sttId || !uhabitsId) return null;
    return {
      sttTypeId: sttId,
      uhabitsHabitId: uhabitsId,
      minDuration: minDuration(),
      copySttComments: copySttComments()
    };
  };

  // Expose API to parent via ref callback
  onMount(() => {
    props.ref?.({ getMapping });
  });

  onCleanup(() => {
    props.ref?.(null as any);
  });

  const sttOptions = createMemo(() => {
    if (!props.sttData) return [];
    const options: Array<{ id: number; type: any }> = [];
    props.sttData.recordTypes.forEach((type: any, id: number) => {
      options.push({ id, type });
    });
    return options;
  });

  const uhabitsOptions = createMemo(() => {
    if (!props.uhabitsData) return { active: [], archived: [] };
    const activeHabits: Array<{ id: number; habit: any }> = [];
    const archivedHabits: Array<{ id: number; habit: any }> = [];

    props.uhabitsData.booleanHabits.forEach((habit: any, id: number) => {
      if (habit.archived) {
        archivedHabits.push({ id, habit });
      } else {
        activeHabits.push({ id, habit });
      }
    });

    return { active: activeHabits, archived: archivedHabits };
  });

  return (
    <div class="mapping-item" data-mapping-id={props.mappingId}>
      <div class="mapping-selects">
        <select
          class="stt-activity-select"
          data-mapping-id={props.mappingId}
          value={sttTypeId()}
          onChange={handleSttChange}
        >
          <option value="">Select STT activity...</option>
          <For each={sttOptions()}>
            {(opt) => (
              <option value={opt.id.toString()}>
                {opt.type.emoji} {opt.type.name} (id: {opt.id})
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
            {(opt) => (
              <option value={opt.id.toString()}>
                {opt.habit.name} (id: {opt.id})
              </option>
            )}
          </For>
          <Show when={uhabitsOptions().archived.length > 0}>
            <option disabled style={{ color: '#888' }}>
              ─── Archived ───
            </option>
            <For each={uhabitsOptions().archived}>
              {(opt) => (
                <option value={opt.id.toString()} style={{ 'font-style': 'italic', opacity: '0.7' }}>
                  {opt.habit.name} (id: {opt.id})
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
        <label class="option-item">
          <span class="option-label">Min duration:</span>
          <input
            type="number"
            class="min-duration-input"
            value={minDuration()}
            min="0"
            step="1"
            title="Minimum duration in minutes"
            onChange={handleMinDurationChange}
          />
          <span class="option-unit">min</span>
        </label>
        <label class="option-item option-checkbox" title="Copy STT activity comments to repetition notes">
          <input
            type="checkbox"
            class="copy-stt-comments-checkbox"
            checked={copySttComments()}
            onChange={(e) => setCopySttComments(e.currentTarget.checked)}
          />
          <span class="option-label">Copy comments</span>
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
            ref={gridRef}
            start-week-on-monday
            class="habit-preview-grid"
            dark-mode
            color-theme="purple"
          />
        </div>
      </Show>
    </div>
  );
};


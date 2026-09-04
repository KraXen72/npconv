import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component, type JSX } from 'solid-js';
import type { ParsedSttBackup } from '../schemas/stt';
import type { ParsedTimeJotBackup } from '../schemas/timejot';
import type { ConversionMapping, ParsedUHabitsBackup, UHabitsHabit } from '../schemas/uhabits';
import { timestampToDayKey } from '../converters/stt-uhabits/uhabitsHelper';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-solid';

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements { 'activity-grid': any; }
  }
}

export type HabitSourceKind = 'stt' | 'timejot';

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
  const [habitId, setHabitId] = createSignal('');
  const [minDuration, setMinDuration] = createSignal(5);
  const [copyNotes, setCopyNotes] = createSignal(false);
  const [numericValue, setNumericValue] = createSignal(1);
  const [currentYear, setCurrentYear] = createSignal(new Date().getFullYear());
  const [yearInitialized, setYearInitialized] = createSignal(false);
  let gridRef: any;

  const sourceOptions = createMemo(() => {
    if (props.sourceKind === 'timejot') {
      return [...(props.timeJotData?.events.values() ?? [])].map(event => ({ id: event.id, label: event.title, archived: Boolean(event.archived) }));
    }
    return [...(props.sttData?.recordTypes.values() ?? [])].map(type => ({ id: type.id, label: `${type.emoji} ${type.name}`.trim(), archived: false }));
  });

  const habitOptions = createMemo(() => {
    const active: UHabitsHabit[] = [];
    const archived: UHabitsHabit[] = [];
    for (const habit of props.uhabitsData?.allHabits.values() ?? []) (habit.archived ? archived : active).push(habit);
    const byName = (a: UHabitsHabit, b: UHabitsHabit) => a.name.localeCompare(b.name);
    return { active: active.sort(byName), archived: archived.sort(byName) };
  });

  const selectedHabit = createMemo(() => props.uhabitsData?.allHabits.get(Number(habitId())) ?? null);

  const sourceDays = createMemo(() => {
    const selected = Number(sourceId());
    if (sourceId() === '' || !Number.isInteger(selected)) return new Set<string>();
    if (props.sourceKind === 'timejot') {
      return new Set(props.timeJotData?.entries.filter(entry => entry.eventId === selected).map(entry => entry.dayKey) ?? []);
    }
    const minimumMs = minDuration() * 60_000;
    return new Set(props.sttData?.records
      .filter(record => record.type_id === selected && record.end_timestamp - record.start_timestamp >= minimumMs)
      .map(record => new Date(record.start_timestamp).toISOString().slice(0, 10)) ?? []);
  });

  const overlap = createMemo(() => {
    const targetId = Number(habitId());
    const incoming = sourceDays();
    const existing = new Set(props.uhabitsData?.repetitions
      .filter(rep => rep.habit_id === targetId)
      .map(rep => timestampToDayKey(rep.timestamp)) ?? []);
    const overlapDays = new Set([...incoming].filter(day => existing.has(day)));
    const allDays = new Set([...incoming, ...existing]);
    return {
      incoming, existing, overlap: overlapDays,
      additions: incoming.size - overlapDays.size,
      grid: [...allDays].sort().map(date => ({ date, count: overlapDays.has(date) ? 3 : incoming.has(date) ? 1 : 2 }))
    };
  });

  createEffect(() => {
    const data = overlap().grid;
    const year = currentYear();
    if (!yearInitialized() && data.length) {
      setCurrentYear(Number(data[data.length - 1].date.slice(0, 4)));
      setYearInitialized(true);
      return;
    }
    if (gridRef) {
      gridRef.data = data;
      gridRef.endDate = `${year}-12-31`;
      gridRef.startDate = `${year}-01-01`;
    }
  });

  const getMapping = (): ConversionMapping | null => {
    const source = Number(sourceId());
    const target = Number(habitId());
    if (sourceId() === '' || habitId() === '' || !Number.isInteger(source) || !Number.isInteger(target)) return null;
    return {
      sourceId: source,
      uhabitsHabitId: target,
      minDuration: props.sourceKind === 'stt' ? minDuration() : 0,
      copySourceNotes: copyNotes(),
      numericValue: selectedHabit()?.type === 1 ? numericValue() : undefined
    };
  };

  createEffect(() => {
    sourceId(); habitId(); minDuration(); copyNotes(); numericValue();
    queueMicrotask(props.onChange);
  });

  onMount(() => props.ref?.({ getMapping }));
  onCleanup(() => props.ref?.(null as any));
  const habitLabel = (habit: UHabitsHabit) => `${habit.name}${habit.type === 1 ? ` · numeric (${habit.unit || 'units'})` : ''}`;

  return (
    <article class="mapping-item" data-mapping-id={props.mappingId}>
      <div class="mapping-header">
        <span class="mapping-number">Mapping {props.mappingId + 1}</span>
        <button class="remove-button" aria-label="Remove mapping" onClick={props.onRemove}><X size={17} /></button>
      </div>
      <div class="mapping-selects">
        <label><span>{props.sourceKind === 'timejot' ? 'TimeJot event' : 'STT activity'}</span>
          <select value={sourceId()} onChange={(event: any) => setSourceId(event.currentTarget.value)}>
            <option value="">Choose source...</option>
            <For each={sourceOptions()}>{option => <option value={option.id}>{option.label}{option.archived ? ' · archived' : ''}</option>}</For>
          </select>
        </label>
        <span class="mapping-arrow" aria-hidden="true"><ArrowRight size={19} /></span>
        <label><span>Loop Habit target</span>
          <select value={habitId()} onChange={(event: any) => setHabitId(event.currentTarget.value)}>
            <option value="">Choose habit...</option>
            <For each={habitOptions().active}>{habit => <option value={habit.id}>{habitLabel(habit)}</option>}</For>
            <Show when={habitOptions().archived.length}><optgroup label="Archived"><For each={habitOptions().archived}>{habit => <option value={habit.id}>{habitLabel(habit)}</option>}</For></optgroup></Show>
          </select>
        </label>
      </div>
      <div class="mapping-options">
        <Show when={props.sourceKind === 'stt'}><label class="field-inline">Minimum duration <input type="number" min="0" step="1" value={minDuration()} onInput={event => setMinDuration(Number(event.currentTarget.value) || 0)} /> min</label></Show>
        <Show when={selectedHabit()?.type === 1}><label class="field-inline numeric-value">Value per source day <input type="number" min="0.001" step="0.001" value={numericValue()} onInput={event => setNumericValue(Number(event.currentTarget.value))} /> {selectedHabit()?.unit || 'units'}</label></Show>
        <label class="checkbox-row"><input type="checkbox" checked={copyNotes()} onChange={event => setCopyNotes(event.currentTarget.checked)} /> Copy source notes</label>
      </div>
      <Show when={sourceId() !== '' && habitId() !== ''}>
        <div class="overlap-summary" aria-label="Data overlap summary">
          <span><strong>{overlap().incoming.size}</strong> source days</span>
          <span><strong>{overlap().existing.size}</strong> existing</span>
          <span class="overlap-count"><strong>{overlap().overlap.size}</strong> overlap</span>
          <span class="addition-count"><strong>{overlap().additions}</strong> new</span>
        </div>
        <details class="calendar-preview">
          <summary>Preview calendar</summary>
          <div class="grid-year-nav"><button type="button" onClick={() => setCurrentYear(currentYear() - 1)} aria-label="Previous year"><ChevronLeft size={16} /></button><strong>{currentYear()}</strong><button type="button" onClick={() => setCurrentYear(currentYear() + 1)} aria-label="Next year"><ChevronRight size={16} /></button></div>
          <div class="grid-scroll"><activity-grid ref={gridRef} start-week-on-monday dark-mode color-theme="purple" /></div>
          <p class="grid-legend">Lighter = source only · medium = existing only · brightest = overlap</p>
        </details>
      </Show>
    </article>
  );
};

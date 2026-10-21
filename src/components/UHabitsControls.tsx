import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
} from 'solid-js';
import type { SqlJsStatic } from 'sql.js';
import { createSttStore } from '../stores/sttStore';
import {
  editUHabitsBackup,
  planHabitEdit,
  MIN_NUMERIC_VALUE,
  MAX_NUMERIC_VALUE,
  type ConversionRule,
  type HabitEdit,
} from '../converters/uhabits/editBackup';
import { HabitEditPreview } from './HabitEditPreview';
import { FileZone } from './FileZone';
import { downloadFile } from '../utils';
import { log } from '../logger';

interface Props {
  SQL: SqlJsStatic;
  onProgressChange: (hasProgress: boolean) => void;
}
const EDIT_ACTIONS = [
  { value: 'change-type', label: 'Change habit type' },
  { value: 'fill', label: 'Fill from another habit' },
  { value: 'copy', label: 'Copy boolean range' },
] as const satisfies readonly { value: HabitEdit['kind']; label: string }[];

type Action = (typeof EDIT_ACTIONS)[number]['value'];

/** Configure edits within one backup; habit choices are restricted to the selected operation. */
export const UHabitsControls: Component<Props> = (props) => {
  const store = createSttStore(props.SQL);
  const [action, setAction] = createSignal<Action>('change-type');
  const [sourceId, setSourceId] = createSignal('');
  const [targetId, setTargetId] = createSignal('');
  const [threshold, setThreshold] = createSignal(1);
  const [comparison, setComparison] = createSignal<ConversionRule['comparison']>('at-least');
  const [checkedValue, setCheckedValue] = createSignal(1);
  const [targetValue, setTargetValue] = createSignal(1);
  const [unit, setUnit] = createSignal('');
  const [start, setStart] = createSignal('');
  const [end, setEnd] = createSignal('');
  const [overwrite, setOverwrite] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [processing, setProcessing] = createSignal(false);
  const [result, setResult] = createSignal('');
  let loadId = 0;

  createEffect(() => props.onProgressChange(loading() || !!store.uhabitsFile()));

  onCleanup(() => {
    loadId++;
    store.clearUHabits();
  });

  const habits = createMemo(() => {
    const allHabits = store.uhabitsData()?.allHabits.values() ?? [];
    return [...allHabits].filter((habit) => habit.type === 0 || habit.type === 1);
  });
  const sources = () => habits().filter((habit) => action() !== 'copy' || habit.type === 0);
  const source = () =>
    sourceId() === '' ? undefined : sources().find((habit) => habit.id === Number(sourceId()));
  const targets = () => {
    const selectedSource = source();
    if (!selectedSource) return [];

    return habits().filter((habit) => {
      const validType = action() === 'copy' ? habit.type === 0 : habit.type !== selectedSource.type;
      return habit.id !== selectedSource.id && validType;
    });
  };
  const target = () =>
    targetId() === '' ? undefined : targets().find((habit) => habit.id === Number(targetId()));
  const numericToBoolean = () => source()?.type === 1;
  const booleanToNumeric = () => source()?.type === 0 && action() !== 'copy';

  const resetSelection = () => {
    setSourceId('');
    setTargetId('');
    setStart('');
    setEnd('');
    setOverwrite(false);
    setResult('');
  };

  const changeAction = (select: HTMLSelectElement) => {
    const nextAction = EDIT_ACTIONS.find((option) => option.value === select.value)?.value;
    if (!nextAction || nextAction === action()) return;

    const clearsSelection =
      sourceId() !== '' || targetId() !== '' || start() !== '' || end() !== '' || overwrite();
    if (
      clearsSelection &&
      !window.confirm(
        'Discard this setup? Changing action will clear your habit selections and date range.'
      )
    ) {
      select.value = action();
      return;
    }

    setAction(nextAction);
    resetSelection();
  };

  const loadFile = async (file: File | null) => {
    const operationId = ++loadId;
    resetSelection();
    store.clearUHabits();
    setLoading(!!file);
    if (file) {
      const loaded = await store.loadUHabitsFile(file);
      if (!loaded && operationId === loadId) {
        setResult('Could not load this backup. Choose a valid uHabits .db file.');
      }
    }
    if (operationId === loadId) setLoading(false);
  };

  const selectSource = (value: string) => {
    setSourceId(value);
    setTargetId('');
    setResult('');
    const habit = source();
    if (habit) {
      setThreshold(habit.type === 1 ? habit.target_value : 1);
      setComparison(habit.type === 1 && habit.target_type === 1 ? 'at-most' : 'at-least');
    }
  };

  const currentEdit = createMemo<HabitEdit>(() => {
    const kind = action();
    const rule: ConversionRule = {
      threshold: threshold(),
      comparison: comparison(),
      checkedValue: checkedValue(),
    };
    if (kind === 'change-type') {
      return {
        ...rule,
        kind,
        habitId: Number(sourceId()),
        unit: unit(),
        targetValue: targetValue(),
      };
    }

    const transfer = {
      sourceId: Number(sourceId()),
      targetId: Number(targetId()),
      range: { start: start(), end: end() },
      overwrite: overwrite(),
    };
    return kind === 'copy' ? { kind, ...transfer } : { kind, ...transfer, ...rule };
  });

  const validation = createMemo(() => {
    const backup = store.uhabitsData();
    const hasSelection = source() && (action() === 'change-type' || target());
    if (!backup || !hasSelection) return { plan: null, error: '' };

    try {
      return { plan: planHabitEdit(backup, currentEdit()), error: '' };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const preview = () => validation().plan;

  const apply = async () => {
    const file = store.uhabitsFile();
    if (!file || !preview() || processing()) return;
    const edit = currentEdit();
    const kind = edit.kind;
    setProcessing(true);
    setResult('');
    try {
      const output = await editUHabitsBackup(file, edit, props.SQL);
      downloadFile(output.blob, `uhabits_${kind}.db`);
      const message = `Downloaded edited backup: ${output.changed} entries written, ${output.preserved} existing entries preserved.`;
      setResult(message);
      log(message, 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult(`Edit failed: ${message}`);
      log(`Edit failed: ${message}`, 'err');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <FileZone
        id="zone-uhabits"
        resetKey="uhabits"
        config={{ title: 'uHabits Backup (.db)', hint: 'Select the backup to edit', accept: '.db' }}
        onFileChange={loadFile}
      />
      <section class="controls-block habit-editor" aria-label="Edit uHabits backup">
        <fieldset class="edit-workspace" disabled={loading() || processing()}>
          <div class="editor-fields">
            <label for="habit-action">Action</label>
            <select
              id="habit-action"
              value={action()}
              onChange={(event) => changeAction(event.currentTarget)}
            >
              <For each={EDIT_ACTIONS}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
            <label for="edit-source">{action() === 'change-type' ? 'Habit' : 'Source'}</label>
            <select
              id="edit-source"
              value={sourceId()}
              onChange={(e) => selectSource(e.currentTarget.value)}
            >
              <option value="">Select a habit…</option>
              <For each={sources()}>
                {(habit) => (
                  <option value={habit.id}>
                    {habit.name} ({habit.type === 0 ? 'boolean' : 'numerical'})
                  </option>
                )}
              </For>
            </select>
            <Show when={action() !== 'change-type'}>
              <label for="edit-target">Destination</label>
              <select
                id="edit-target"
                value={targetId()}
                disabled={!source()}
                onChange={(e) => {
                  setTargetId(e.currentTarget.value);
                  setResult('');
                }}
              >
                <option value="">Select a habit…</option>
                <For each={targets()}>
                  {(habit) => (
                    <option value={habit.id}>
                      {habit.name} ({habit.type === 0 ? 'boolean' : 'numerical'})
                    </option>
                  )}
                </For>
              </select>
            </Show>
          </div>
          <Show when={source()}>
            <div class="editor-fields">
              <Show when={numericToBoolean()}>
                <label for="numeric-comparison">Checked if</label>
                <select
                  id="numeric-comparison"
                  value={comparison()}
                  onChange={(e) =>
                    setComparison(e.currentTarget.value === 'at-most' ? 'at-most' : 'at-least')
                  }
                >
                  <option value="at-least">Value is at least</option>
                  <option value="at-most">Value is at most</option>
                </select>
                <label for="numeric-threshold">Threshold</label>
                <input
                  id="numeric-threshold"
                  type="number"
                  min="0"
                  step="any"
                  value={threshold()}
                  onInput={(e) => setThreshold(e.currentTarget.valueAsNumber)}
                />
              </Show>
              <Show when={booleanToNumeric()}>
                <label for="checked-value">Checked → value</label>
                <input
                  id="checked-value"
                  type="number"
                  min={MIN_NUMERIC_VALUE}
                  max={MAX_NUMERIC_VALUE}
                  step={MIN_NUMERIC_VALUE}
                  value={checkedValue()}
                  onInput={(e) => setCheckedValue(e.currentTarget.valueAsNumber)}
                />
                <Show when={action() === 'change-type'}>
                  <label for="numeric-unit">Unit</label>
                  <input
                    id="numeric-unit"
                    type="text"
                    value={unit()}
                    onInput={(e) => setUnit(e.currentTarget.value)}
                  />
                  <label for="numeric-goal">Goal</label>
                  <input
                    id="numeric-goal"
                    type="number"
                    min={MIN_NUMERIC_VALUE}
                    max={MAX_NUMERIC_VALUE}
                    step={MIN_NUMERIC_VALUE}
                    value={targetValue()}
                    onInput={(e) => setTargetValue(e.currentTarget.valueAsNumber)}
                  />
                </Show>
              </Show>
              <Show when={action() !== 'change-type'}>
                <label for="range-start">From</label>
                <input
                  id="range-start"
                  type="date"
                  value={start()}
                  onInput={(e) => setStart(e.currentTarget.value)}
                />
                <label for="range-end">Through</label>
                <input
                  id="range-end"
                  type="date"
                  value={end()}
                  onInput={(e) => setEnd(e.currentTarget.value)}
                />
              </Show>
            </div>
            <Show when={action() !== 'change-type'}>
              <label class="option-checkbox overwrite-option">
                <input
                  type="checkbox"
                  checked={overwrite()}
                  onChange={(e) => setOverwrite(e.currentTarget.checked)}
                />{' '}
                Replace existing days
              </label>
            </Show>
          </Show>
          <Show when={validation().error}>
            <p class="editor-error" role="alert">
              {validation().error}
            </p>
          </Show>
          <Show when={preview()}>
            {(plan) => <HabitEditPreview plan={plan()} edit={currentEdit()} />}
          </Show>
          <Show when={loading()}>
            <p role="status">Loading backup…</p>
          </Show>
          <div class="controls">
            <button
              type="button"
              disabled={!preview() || loading() || processing()}
              onClick={apply}
            >
              Download edited backup
            </button>
          </div>
          <div class="edit-notes">
            <span>New copy per download</span>
            <Show when={action() === 'change-type'}>
              <span>Entire history</span>
            </Show>
            <Show when={action() === 'fill'}>
              <span>Empty dates = all history</span>
            </Show>
            <Show when={booleanToNumeric()}>
              <span>Unchecked → 0 · skip / auto → unknown</span>
            </Show>
          </div>
        </fieldset>
        <p role="status" aria-live="polite">
          {result()}
        </p>
      </section>
    </>
  );
};

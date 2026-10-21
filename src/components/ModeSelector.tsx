import { For, Show, type Component } from 'solid-js';
import { getWorkflow, WORKFLOWS, type Mode } from '../workflows';

interface Props {
  mode: () => Mode;
  setMode: (mode: Mode) => void;
  disabled?: boolean;
}

/** Expose only supported routes and restore native control selections when a mode change is cancelled. */
export const ModeSelector: Component<Props> = (props) => {
  const workflow = () => getWorkflow(props.mode());
  const modes = () => [...workflow().modes];

  const selectWorkflow = (input: HTMLInputElement, defaultMode: Mode) => {
    props.setMode(defaultMode);

    // native radios update before the discard confirmation, even when the mode stays unchanged
    const radios = input.closest('.mode-switch')?.querySelectorAll<HTMLInputElement>('input');
    radios?.forEach((radio) => {
      radio.checked = radio.value === workflow().value;
    });
  };

  const selectMode = (select: HTMLSelectElement) => {
    const option = modes().find((mode) => mode.value === select.value);
    if (option) props.setMode(option.value);
    select.value = props.mode();
  };

  return (
    <div class="mode-selector">
      <div class="mode-switch" role="radiogroup" aria-label="Backup workflow">
        <For each={WORKFLOWS}>
          {(option) => (
            <>
              <input
                type="radio"
                id={`mode-${option.value}`}
                name="workflow"
                value={option.value}
                checked={workflow().value === option.value}
                disabled={props.disabled}
                onChange={(event) => selectWorkflow(event.currentTarget, option.modes[0].value)}
              />
              <label for={`mode-${option.value}`} class="mode-pill">
                {option.label}
              </label>
            </>
          )}
        </For>
      </div>
      <Show when={modes().length > 1}>
        <div class="workflow-options">
          <label for={workflow().selectId}>{workflow().contextLabel}</label>
          <select
            id={workflow().selectId}
            value={props.mode()}
            disabled={props.disabled}
            onChange={(event) => selectMode(event.currentTarget)}
          >
            <For each={modes()}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
          <Show when={workflow().value === 'import'}>
            <span>→ uHabits</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

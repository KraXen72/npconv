import { For, type Component } from 'solid-js';

export type Mode = 'merge' | 'convert' | 'stt';

interface Props {
  mode: () => Mode;
  setMode: (mode: Mode) => void;
}

interface ModeOption {
  id: string;
  value: Mode;
  labelText: string;
}

const modeOptions: ModeOption[] = [
  { id: 'mode-merge', value: 'merge', labelText: 'NewPipe ⇌ LibreTube: Merge' },
  { id: 'mode-convert', value: 'convert', labelText: 'NewPipe ⇌ LibreTube: Convert' },
  { id: 'mode-stt', value: 'stt', labelText: 'SimpleTimeTracker → uHabits' },
];

export const ModeSelector: Component<Props> = (props) => {
  return (
    <div class="mode-selector">
      <div class="mode-switch" role="radiogroup" aria-label="Mode selector">
        <For each={modeOptions}>
          {(option) => (
            <>
              <input
                type="radio"
                id={option.id}
                name="mode"
                value={option.value}
                checked={props.mode() === option.value}
                onChange={() => props.setMode(option.value)}
              />
              <label for={option.id} class="mode-pill">
                {option.labelText}
              </label>
            </>
          )}
        </For>
      </div>
    </div>
  );
};

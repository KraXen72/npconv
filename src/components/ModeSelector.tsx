import { For, type Component } from 'solid-js';

export type Mode = 'merge' | 'convert' | 'stt' | 'timejot';

interface Props {
  mode: () => Mode;
  setMode: (mode: Mode) => void;
}

interface ModeOption {
  id: string;
  value: Mode;
  labelText: string;
  route: string;
}

const modeOptions: ModeOption[] = [
  { id: 'mode-merge', value: 'merge', labelText: 'Merge', route: 'NewPipe ⇄ LibreTube' },
  { id: 'mode-convert', value: 'convert', labelText: 'Convert', route: 'NewPipe ⇄ LibreTube' },
  { id: 'mode-stt', value: 'stt', labelText: 'Time Tracker', route: 'SimpleTimeTracker → uHabits' },
  { id: 'mode-timejot', value: 'timejot', labelText: 'TimeJot', route: 'TimeJot → uHabits' },
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
                <span class="mode-name">{option.labelText}</span>
                <span class="mode-route">{option.route}</span>
              </label>
            </>
          )}
        </For>
      </div>
    </div>
  );
};

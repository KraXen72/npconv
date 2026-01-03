import type { Component } from 'solid-js';

export type Mode = 'merge' | 'convert' | 'stt';

interface Props {
  mode: () => Mode;
  setMode: (mode: Mode) => void;
}

export const ModeSelector: Component<Props> = (props) => {
  return (
    <div class="mode-selector">
      <div class="mode-switch" role="tablist" aria-label="Mode selector">
        <input
          type="radio"
          id="mode-merge"
          name="mode"
          value="merge"
          checked={props.mode() === 'merge'}
          onChange={() => props.setMode('merge')}
        />
        <label for="mode-merge" class="mode-pill">
          NewPipe ⇌ LibreTube: Merge
        </label>

        <input
          type="radio"
          id="mode-convert"
          name="mode"
          value="convert"
          checked={props.mode() === 'convert'}
          onChange={() => props.setMode('convert')}
        />
        <label for="mode-convert" class="mode-pill">
          NewPipe ⇌ LibreTube: Convert
        </label>

        <input
          type="radio"
          id="mode-stt"
          name="mode"
          value="stt"
          checked={props.mode() === 'stt'}
          onChange={() => props.setMode('stt')}
        />
        <label for="mode-stt" class="mode-pill">
          SimpleTimeTracker → uHabits
        </label>
      </div>
    </div>
  );
};

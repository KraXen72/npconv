import { type Component } from 'solid-js';

export type Mode = 'merge' | 'convert' | 'stt' | 'timejot';

interface Props {
  mode: () => Mode;
  setMode: (mode: Mode) => void;
}

interface AppNodeProps { short: string; name: string; tone: string; }
const AppNode: Component<AppNodeProps> = props => (
  <span class="app-node">
    <span class={`app-icon ${props.tone}`}>{props.short}</span>
    <span>{props.name}</span>
  </span>
);

export const ModeSelector: Component<Props> = (props) => {
  const select = (mode: Mode) => props.setMode(mode);
  const isVideo = () => props.mode() === 'merge' || props.mode() === 'convert';

  return (
    <section class="conversion-picker" aria-labelledby="conversion-picker-title">
      <div class="picker-heading">
        <div><span class="eyebrow">Conversion map</span><h2 id="conversion-picker-title">What are you moving?</h2></div>
        <span class="privacy-note">Runs locally · files never leave this device</span>
      </div>

      <div class="route-grid">
        <article class="route-card video-route" classList={{ selected: isVideo() }}>
          <button class="route-main" type="button" onClick={() => select(props.mode() === 'convert' ? 'convert' : 'merge')} aria-pressed={isVideo()}>
            <span class="route-status">Two-way</span>
            <span class="route-apps"><AppNode short="NP" name="NewPipe" tone="red" /><span class="route-arrow">⇄</span><AppNode short="LT" name="LibreTube" tone="blue" /></span>
          </button>
          <div class="route-actions" role="group" aria-label="NewPipe and LibreTube operation">
            <button type="button" classList={{ active: props.mode() === 'merge' }} onClick={() => select('merge')}>Merge histories</button>
            <button type="button" classList={{ active: props.mode() === 'convert' }} onClick={() => select('convert')}>Convert one backup</button>
          </div>
        </article>

        <button class="route-card route-main" classList={{ selected: props.mode() === 'stt' }} type="button" onClick={() => select('stt')} aria-pressed={props.mode() === 'stt'}>
          <span class="route-status">Backfill</span>
          <span class="route-apps"><AppNode short="ST" name="Simple Time Tracker" tone="amber" /><span class="route-arrow">→</span><AppNode short="LH" name="Loop Habits" tone="green" /></span>
        </button>

        <button class="route-card route-main" classList={{ selected: props.mode() === 'timejot' }} type="button" onClick={() => select('timejot')} aria-pressed={props.mode() === 'timejot'}>
          <span class="route-status new">New · backfill</span>
          <span class="route-apps"><AppNode short="TJ" name="TimeJot" tone="purple" /><span class="route-arrow">→</span><AppNode short="LH" name="Loop Habits" tone="green" /></span>
        </button>
      </div>
    </section>
  );
};

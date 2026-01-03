import type { Component, JSX } from 'solid-js';
import { createSignal } from 'solid-js';

interface Props {
  onMerge: (direction: 'to_newpipe' | 'to_libretube', playlistBehavior: string) => void;
}

export const MergeControls: Component<Props> = (props) => {
  const [direction, setDirection] = createSignal<'to_newpipe' | 'to_libretube'>('to_newpipe');
  const [playlistBehavior, setPlaylistBehavior] = createSignal('merge_lt_precedence');

  const handleDirectionChange: JSX.EventHandler<HTMLInputElement, Event> = (e) => {
    const newDirection = e.currentTarget.checked ? 'to_libretube' : 'to_newpipe';
    setDirection(newDirection);
    // Update playlist behavior default based on direction
    setPlaylistBehavior(newDirection === 'to_libretube' ? 'merge_np_precedence' : 'merge_lt_precedence');
  };

  const handleMerge = () => {
    props.onMerge(direction(), playlistBehavior());
  };

  return (
    <section id="action-newpipe-libretube-merge" class="controls-block">
      <h3>NewPipe ⇌ LibreTube: Merge</h3>
      
      <div class="merge-options">
        <label for="playlist-behavior">Playlists handling:</label>
        <select
          id="playlist-behavior"
          value={playlistBehavior()}
          onChange={(e) => setPlaylistBehavior(e.currentTarget.value)}
        >
          <option value="merge_np_precedence">Merge playlists (NewPipe precedence)</option>
          <option value="merge_lt_precedence">Merge playlists (LibreTube precedence)</option>
          <option value="only_newpipe">Only NewPipe playlists</option>
          <option value="only_libretube">Only LibreTube playlists</option>
        </select>
      </div>

      <div class="direction-toggle">
        <span class="dir-label">NewPipe</span>
        <label class="two-way">
          <input
            type="checkbox"
            id="merge-direction"
            aria-label="Merge direction"
            checked={direction() === 'to_libretube'}
            onChange={handleDirectionChange}
          />
          <span class="slider" aria-hidden="true">
            <svg class="toggle-arrow" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 13a1 1 0 0 0-1-1H5.061a1 1 0 0 1-.75-1.811l6.836-6.835a1.207 1.207 0 0 1 1.707 0l6.835 6.835a1 1 0 0 1-.75 1.811H16a1 1 0 0 0-1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z" />
            </svg>
          </span>
        </label>
        <span class="dir-label">LibreTube</span>
      </div>

      <div class="controls">
        <button id="btn-merge" type="button" onClick={handleMerge}>
          Merge
        </button>
      </div>
    </section>
  );
};

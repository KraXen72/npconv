import type { Component } from 'solid-js';

interface Props {
  onConvert: (direction: 'to_newpipe' | 'to_libretube') => void;
}

export const ConvertControls: Component<Props> = (props) => {
  return (
    <section id="action-newpipe-libretube-convert" class="controls-block">
      <h2>NewPipe ⇌ LibreTube: Convert</h2>
      
      <div class="controls">
        <button id="btn-to-newpipe" type="button" onClick={() => props.onConvert('to_newpipe')}>
          Target: NewPipe
        </button>
        <button id="btn-to-libretube" type="button" onClick={() => props.onConvert('to_libretube')}>
          Target: LibreTube
        </button>
      </div>
    </section>
  );
};

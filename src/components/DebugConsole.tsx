import { createEffect } from 'solid-js';
import { logStore } from '../logger';

export function DebugConsole() {
  let consoleRef: HTMLDivElement | undefined;

  createEffect(() => {
    // Access the signal to trigger reactivity
    logStore.logs();
    
    if (consoleRef) {
      consoleRef.scrollTop = consoleRef.scrollHeight;
    }
  });

  return (
    <section class="log-section" aria-labelledby="log-heading">
      <div class="log-header">
        <h2 id="log-heading">Activity log</h2>
        <span>Conversion details &amp; diagnostics</span>
      </div>
      <div id="debug-console" role="log" aria-label="Conversion activity" tabindex="0" ref={consoleRef} innerHTML={logStore.logs()} />
    </section>
  );
}

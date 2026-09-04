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
    <section class="debug-panel" aria-labelledby="activity-title">
      <div class="debug-heading">
        <div><span class="status-dot" aria-hidden="true" /><h2 id="activity-title">Conversion activity</h2></div>
        <span>Live progress and validation details</span>
      </div>
      <div id="debug-console" ref={consoleRef} innerHTML={logStore.logs()} />
    </section>
  );
}

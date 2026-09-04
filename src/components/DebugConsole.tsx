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
    <>
      <h3>debug log</h3>
      <div id="debug-console" ref={consoleRef} innerHTML={logStore.logs()} />
    </>
  );
}

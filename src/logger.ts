import { createSignal } from 'solid-js';
import { escapeHtml } from './utils';

// Store for reactive log output
function createLogStore() {
  const [logs, setLogs] = createSignal('');

  return {
    logs,
    append(msg: string, type = 'info') {
      const timestamp = new Date().toLocaleTimeString();
      const className = type === 'err' ? 'log-err' 
        : type === 'warn' ? 'log-warn' 
        : type === 'schema' ? 'log-schema' 
        : 'log-info';
      
      const escapedMsg = escapeHtml(msg);
      const line = `<div class="${className}">[${timestamp}] ${escapedMsg}</div>`;
      setLogs(prev => prev + line);
    }
  };
}

export const logStore = createLogStore();

// Logging helper that appends to the reactive log store
export function log(msg: string, type = "info") {
  logStore.append(msg, type);
}


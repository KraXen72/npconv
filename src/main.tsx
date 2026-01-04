import '../style.css';
import 'activity-grid';
import { render } from 'solid-js/web';
import { App } from './components/App';
import { initSQL as initSqlJs } from './sqlHelper';
import { log } from './logger';
import type { SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic | undefined;

// --- Initialization ---
async function init() {
  log("Initializing SQL.js...");
  try {
    SQL = await initSqlJs();
    log("SQL.js ready.");
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("Failed to load SQL.js:", errorMsg);
    log(`Failed to load SQL.js: ${errorMsg}. Please refresh the page to retry.`, "err");
    return;
  }

  // Mount Solid app
  const root = document.getElementById('app');
  if (!root) {
    const errorMsg = 'Root element #app not found in document. Cannot mount application.';
    console.error(errorMsg);
    log(errorMsg, 'err');
    throw new Error(errorMsg);
  }
  
  render(() => <App SQL={SQL} />, root);
}

init();



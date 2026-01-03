import '../style.css';
import 'activity-grid';
import { render } from 'solid-js/web';
import { App } from './components/App';
import { initSQL as initSqlJs } from './sqlHelper';
import { log } from './logger';
import type { SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic;

// --- Initialization ---
async function init() {
  log("Initializing SQL.js...");
  try {
    SQL = await initSqlJs();
    log("SQL.js ready.");
  } catch (e: any) {
    log("Error loading SQL.js: " + (e.message || e.toString()), "err");
    return;
  }

  // Mount Solid app
  const root = document.getElementById('app');
  if (root) {
    render(() => <App SQL={SQL} />, root);
  }
}

init();



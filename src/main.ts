import '../style.css';
import 'activity-grid';
import { initSQL as initSqlJs } from './sqlHelper';
import { log } from './logger';
import { convertToNewPipe } from './converters/newpipe-libretube/toNewPipe';
import { convertToLibreTube } from './converters/newpipe-libretube/toLibreTube';
import { setupSttHandlers } from './converters/stt-uhabits/sttHandlers';
import type { SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic;

function isNewPipeMode(mode: string): boolean {
	return mode === 'merge' || mode === 'convert';
}

// --- Initialization ---
window.onload = async () => {
  log("Initializing SQL.js...");
  try {
    SQL = await initSqlJs();
    log("SQL.js ready.");
  } catch (e: any) {
    log("Error loading SQL.js: " + (e.message || e.toString()), "err");
  }
  updateUI();
  setupDropZones();
  setupSttHandlers(SQL);
};

const UIMap: Record<string, string[]> = {
	"action-newpipe-libretube-merge": ["merge"],
	"action-newpipe-libretube-convert": ["convert"],
	"action-stt-uhabits-fill": ["stt"],
	"global-options": ["convert", "merge"],
	"main-file-area": ["convert", "merge", "stt"],
} as const;

// --- UI Logic ---
export function updateUI() {
  const modeEl = document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null;
  const mode = modeEl ? modeEl.value : 'convert';

  const mergeBlock = document.getElementById('action-newpipe-libretube-merge') as HTMLDivElement | null;
  const convertBlock = document.getElementById('action-newpipe-libretube-convert') as HTMLDivElement | null;
  const sttBlock = document.getElementById('action-stt-uhabits-fill') as HTMLDivElement | null;
  const globalOptions = document.getElementById("global-options") as HTMLDivElement | null;
  const mainFileArea = document.getElementById('main-file-area') as HTMLDivElement | null;

  if (!mergeBlock || !convertBlock || !sttBlock || !globalOptions || !mainFileArea) return;

  // Show/hide blocks based on mode
  for (const [id, allowedModes] of Object.entries(UIMap)) {
    const elem = document.getElementById(id);
    if (!elem) continue;
    elem.style.display = allowedModes.includes(mode) ? '' : 'none';
  }

  // Update dynamic content in file zones based on mode
  document.querySelectorAll('.zone-title, .zone-hint').forEach(elem => {
    const attr = elem.getAttribute(`data-${mode}`);
    if (attr) elem.innerHTML = attr;
  });

  // Clear file inputs only when switching between different converter types (newpipe/libretube vs stt)
  // Don't clear when switching between merge and convert (both are newpipe modes)
  const prevModeKey = (window as any).prevMode;
  const prevWasNewpipe = isNewPipeMode(prevModeKey);
  const currentIsNewpipe = isNewPipeMode(mode);
  const shouldClearFiles = prevModeKey && (prevWasNewpipe !== currentIsNewpipe);
  
  const fileLeft = document.getElementById('file-left') as HTMLInputElement | null;
  const fileRight = document.getElementById('file-right') as HTMLInputElement | null;
  if (fileLeft) {
    const accept = fileLeft.getAttribute(`data-${mode}`);
    if (accept) fileLeft.accept = accept;
    if (shouldClearFiles) {
      fileLeft.value = '';
      fileLeft.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  if (fileRight) {
    const accept = fileRight.getAttribute(`data-${mode}`);
    if (accept) fileRight.accept = accept;
    if (shouldClearFiles) {
      fileRight.value = '';
      fileRight.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  
  // Remember current mode for next time
  (window as any).prevMode = mode;
}

export async function processBackup(direction: 'to_newpipe' | 'to_libretube') {
  const modeEl = document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null;
  const mode = modeEl ? modeEl.value : 'convert';
  const leftFile = (document.getElementById('file-left') as HTMLInputElement).files?.[0];
  const rightFile = (document.getElementById('file-right') as HTMLInputElement).files?.[0];
  const npFile = leftFile;
  const ltFile = rightFile;

  if (mode === 'merge' && (!leftFile || !rightFile)) {
    return log("Merge mode requires BOTH files.", "err");
  }
  if (mode === 'convert') {
    if (direction === 'to_newpipe' && !rightFile) return log("Missing LibreTube source file.", "err");
    if (direction === 'to_libretube' && !leftFile) return log("Missing NewPipe source file.", "err");
  }

  try {
    document.querySelectorAll('.controls button').forEach(btn => (btn as HTMLButtonElement).disabled = true);
    // pass playlist handling option from UI
    const playlistSelect = document.getElementById('playlist-behavior') as HTMLSelectElement | null;
    const playlistBehavior = playlistSelect ? playlistSelect.value : undefined;
    const includeWatchEl = document.getElementById('include-watch-history') as HTMLInputElement | null;
    const includeWatchHistory = includeWatchEl ? includeWatchEl.checked : true;
    if (direction === 'to_newpipe') {
      await convertToNewPipe(npFile, ltFile as File, mode, SQL, playlistBehavior);
    } else {
      await convertToLibreTube(npFile, ltFile, mode, SQL, playlistBehavior, includeWatchHistory);
    }
  } catch (e: any) {
    log(`FATAL ERROR: ${e.message || e.toString() || 'An unknown error occurred'}`, "err");
    if (e.stack) log(`Stack Trace: ${e.stack}`, "err");
    else log(`Error Object: ${e.toString()}`, "err");
    console.error(e);
  } finally {
    document.querySelectorAll('.controls button').forEach(btn => (btn as HTMLButtonElement).disabled = false);
  }
}

// Expose to global for HTML bindings
(window as any).processBackup = processBackup;
(window as any).updateUI = updateUI;

// Wire merge button and direction behavior
window.addEventListener('DOMContentLoaded', () => {
  const mergeBtn = document.getElementById('btn-merge') as HTMLButtonElement | null;
  const dirToggle = document.getElementById('merge-direction') as HTMLInputElement | null;
  const playlistSelect = document.getElementById('playlist-behavior') as HTMLSelectElement | null;

    if (mergeBtn && dirToggle && playlistSelect) {
    // default select based on toggle initial state
    // Note: when merging LibreTube -> NewPipe (target NewPipe), LibreTube playlists should have precedence by default.
    // Our toggle: unchecked => merge into NewPipe (LibreTube -> NewPipe), checked => merge into LibreTube (NewPipe -> LibreTube).
    playlistSelect.value = dirToggle.checked ? 'merge_np_precedence' : 'merge_lt_precedence';

    dirToggle.addEventListener('change', () => {
      // when direction changes, set a reasonable default for playlist handling
      if (dirToggle.checked) {
        // checked: merging into LibreTube (NewPipe -> LibreTube) -> NewPipe precedence
        playlistSelect.value = 'merge_np_precedence';
      } else {
        // unchecked: merging into NewPipe (LibreTube -> NewPipe) -> LibreTube precedence
        playlistSelect.value = 'merge_lt_precedence';
      }
    });

    mergeBtn.addEventListener('click', async () => {
      // determine target based on direction toggle: unchecked => merge into NewPipe, checked => merge into LibreTube
      const target = dirToggle.checked ? 'to_libretube' : 'to_newpipe';
      await processBackup(target as any);
    });
  }
});

// Setup clickable + drag-and-drop behavior for .drop-zone elements
function setupDropZones() {
  document.querySelectorAll('.drop-zone').forEach(zone => {
    const input = zone.querySelector('input[type="file"]') as HTMLInputElement | null;
    const nameEl = zone.querySelector('.file-name') as HTMLElement | null;
    const clearBtn = zone.querySelector('.clear-file') as HTMLButtonElement | null;
    if (!input) return;

    // Click anywhere in zone to open file picker
    zone.addEventListener('click', (e) => {
      if (e.target === input || e.target === clearBtn) return;
      input.click();
    });

    // Keyboard accessible (Enter / Space)
    zone.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    // Drag & Drop
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('active');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('active');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('active');
      const files = (e as DragEvent).dataTransfer && (e as DragEvent).dataTransfer!.files;
      if (files && files.length) {
        try {
          const dt = new DataTransfer();
          for (let i = 0; i < files.length; i++) dt.items.add(files[i]);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (err) {
          console.warn('Could not set input.files programmatically', err);
        }
      }
    });

    // Reflect selected filename in UI
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      
      // Validate file extension
      if (f) {
        const modeEl = document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null;
        const mode = modeEl ? modeEl.value : 'convert';
        const allowedExts = input.getAttribute(`data-${mode}`);
        
        if (allowedExts) {
          const exts = allowedExts.split(',').map(ext => ext.trim().toLowerCase());
          const fileName = f.name.toLowerCase();
          const isValid = exts.some(ext => fileName.endsWith(ext));
          
          if (!isValid) {
            log(`Invalid file type. Expected: ${exts.join(', ')}`, 'err');
            input.value = '';
            if (nameEl) nameEl.textContent = '';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
          }
        }
      }
      
      if (nameEl) nameEl.textContent = f ? f.name : '';
      if (clearBtn) clearBtn.style.display = f ? 'flex' : 'none';
    });

    // Clear button handler
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  });
}


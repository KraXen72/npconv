import '../style.css';
import { initSQL } from './sqlHelper';
import { log } from './logger';
import { convertToNewPipe } from './converters/toNewPipe';
import { convertToLibreTube } from './converters/toLibreTube';

let SQL: any;

// --- Initialization ---
window.onload = async () => {
  log("Initializing SQL.js...");
  try {
    SQL = await initSQL();
    log("SQL.js ready.");
  } catch (e: any) {
    log("Error loading SQL.js: " + (e.message || e.toString()), "err");
  }
  updateUI();
  setupDropZones();
};

// --- UI Logic ---
export function updateUI() {
  const modeEl = document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null;
  const mode = modeEl ? modeEl.value : 'convert';
  const fileNP = document.getElementById('file-newpipe') as HTMLInputElement | null;
  const fileLT = document.getElementById('file-libretube') as HTMLInputElement | null;
  const mergeBlock = document.getElementById('merge-controls') as HTMLDivElement | null;
  const convertBlock = document.getElementById('convert-controls') as HTMLDivElement | null;

  if (!fileNP || !fileLT || !mergeBlock || !convertBlock) return;

  if (mode === 'merge') {
    mergeBlock.style.display = '';
    convertBlock.style.display = 'none';
    fileNP.disabled = false;
    fileLT.disabled = false;
  } else {
    mergeBlock.style.display = 'none';
    convertBlock.style.display = '';
    // in convert mode, allow picking either file depending on action
    fileNP.disabled = false;
    fileLT.disabled = false;
  }
}

export async function processBackup(direction: 'to_newpipe' | 'to_libretube') {
  const modeEl = document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null;
  const mode = modeEl ? modeEl.value : 'convert';
  const npFile = (document.getElementById('file-newpipe') as HTMLInputElement).files?.[0];
  const ltFile = (document.getElementById('file-libretube') as HTMLInputElement).files?.[0];

  if (mode === 'merge' && (!npFile || !ltFile)) {
    return log("Merge mode requires BOTH files.", "err");
  }
  if (mode === 'convert') {
    if (direction === 'to_newpipe' && !ltFile) return log("Missing LibreTube source file.", "err");
    if (direction === 'to_libretube' && !npFile) return log("Missing NewPipe source file.", "err");
  }

  try {
    document.querySelectorAll('.controls button').forEach(btn => (btn as HTMLButtonElement).disabled = true);
    if (direction === 'to_newpipe') {
      await convertToNewPipe(npFile, ltFile as File, mode, SQL);
    } else {
      await convertToLibreTube(npFile, ltFile, mode, SQL);
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
    if (!input) return;

    // Click anywhere in zone to open file picker
    zone.addEventListener('click', (e) => {
      if (e.target === input) return;
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
      if (nameEl) nameEl.textContent = f ? f.name : '';
    });
  });
}

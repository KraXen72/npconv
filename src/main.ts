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
  const btnNP = document.getElementById('btn-to-newpipe') as HTMLButtonElement | null;
  const btnLT = document.getElementById('btn-to-libretube') as HTMLButtonElement | null;
  const fileNP = document.getElementById('file-newpipe') as HTMLInputElement | null;
  const fileLT = document.getElementById('file-libretube') as HTMLInputElement | null;

  if (!btnNP || !btnLT || !fileNP || !fileLT) return;

  if (mode === 'merge') {
    btnNP.textContent = "Merge into NewPipe";
    btnLT.textContent = "Merge into LibreTube";
    fileNP.disabled = false;
    fileLT.disabled = false;
  } else {
    btnNP.textContent = "Convert LibreTube -> NewPipe";
    btnLT.textContent = "Convert NewPipe -> LibreTube";
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

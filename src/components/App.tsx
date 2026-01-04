import { createSignal, Show, type Component, onCleanup } from 'solid-js';
import { ModeSelector, type Mode } from './ModeSelector';
import { FileZone } from './FileZone';
import { MergeControls } from './MergeControls';
import { ConvertControls } from './ConvertControls';
import { SttControls } from './SttControls';
import { DebugConsole } from './DebugConsole';
import { log } from '../logger';
import { convertToNewPipe } from '../converters/newpipe-libretube/toNewPipe';
import { convertToLibreTube } from '../converters/newpipe-libretube/toLibreTube';
import { convertSttToUHabits } from '../converters/stt-uhabits/toUHabits';
import { createSttStore } from '../stores/sttStore';
import { downloadFile } from '../utils';
import type { SqlJsStatic } from 'sql.js';
import type { ConversionMapping } from '../types/uhabits';

interface Props {
  SQL: SqlJsStatic;
}

export const App: Component<Props> = (props) => {
  const [mode, setMode] = createSignal<Mode>('merge');
  const [leftFile, setLeftFile] = createSignal<File | null>(null);
  const [rightFile, setRightFile] = createSignal<File | null>(null);
  const [includeWatchHistory, setIncludeWatchHistory] = createSignal(true);
  const [processing, setProcessing] = createSignal(false);
  const [sttMappings, setSttMappings] = createSignal<ConversionMapping[]>([]);

  // Create STT store
  const sttStore = createSttStore(props.SQL);

  // Cleanup on unmount
  onCleanup(() => {
    const data = sttStore.uhabitsData();
    if (data?.db) data.db.close();
  });

  const isNewPipeMode = () => mode() === 'merge' || mode() === 'convert';

  // Clear files when switching between different converter types
  let prevModeType: 'newpipe' | 'stt' = 'newpipe';
  const handleModeChange = (newMode: Mode) => {
    const newModeType = (newMode === 'merge' || newMode === 'convert') ? 'newpipe' : 'stt';
    if (prevModeType !== newModeType) {
      setLeftFile(null);
      setRightFile(null);
    }
    prevModeType = newModeType;
    setMode(newMode);
  };

  const leftFileConfigs = {
    merge: {
      title: 'NewPipe Backup (.zip)',
      hint: 'Contains newpipe.db<br>click/drop file to upload',
      accept: '.zip'
    },
    convert: {
      title: 'NewPipe Backup (.zip)',
      hint: 'Contains newpipe.db<br>click/drop file to upload',
      accept: '.zip'
    },
    stt: {
      title: 'Simple Time Tracker (.backup)',
      hint: 'Upload your .backup file<br>click/drop file to upload',
      accept: '.backup'
    }
  };

  const rightFileConfigs = {
    merge: {
      title: 'LibreTube Backup (.json)',
      hint: 'JSON export file<br>click/drop file to upload',
      accept: '.json'
    },
    convert: {
      title: 'LibreTube Backup (.json)',
      hint: 'JSON export file<br>click/drop file to upload',
      accept: '.json'
    },
    stt: {
      title: 'uHabits Backup (.db)',
      hint: 'Upload your .db file<br>click/drop file to upload',
      accept: '.db'
    }
  };

  const handleLeftFileChange = async (file: File | null) => {
    setLeftFile(file);
    if (mode() === 'stt' && file) {
      try {
        await sttStore.loadSttFile(file);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('Failed to load STT file:', errorMsg);
        log(`Failed to load STT file: ${errorMsg}`, 'err');
        setLeftFile(null);
      }
    }
  };

  const handleRightFileChange = async (file: File | null) => {
    setRightFile(file);
    if (mode() === 'stt' && file) {
      try {
        await sttStore.loadUHabitsFile(file);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('Failed to load uHabits file:', errorMsg);
        log(`Failed to load uHabits file: ${errorMsg}`, 'err');
        setRightFile(null);
      }
    }
  };

  const processBackup = async (direction: 'to_newpipe' | 'to_libretube', playlistBehavior?: string) => {
    const currentMode = mode();
    const npFile = leftFile();
    const ltFile = rightFile();

    if (currentMode === 'merge' && (!npFile || !ltFile)) {
      return log("Merge mode requires BOTH files.", "err");
    }
    if (currentMode === 'convert') {
      if (direction === 'to_newpipe' && !ltFile) return log("Missing LibreTube source file.", "err");
      if (direction === 'to_libretube' && !npFile) return log("Missing NewPipe source file.", "err");
    }

    try {
      setProcessing(true);
      if (direction === 'to_newpipe') {
        await convertToNewPipe(npFile, ltFile as File, currentMode, props.SQL, playlistBehavior);
      } else {
        await convertToLibreTube(npFile as File, ltFile, currentMode, props.SQL, playlistBehavior, includeWatchHistory());
      }
    } catch (e: any) {
      log(`FATAL ERROR: ${e.message || e.toString() || 'An unknown error occurred'}`, "err");
      if (e.stack) log(`Stack Trace: ${e.stack}`, "err");
      else log(`Error Object: ${e.toString()}`, "err");
      console.error(e);
    } finally {
      setProcessing(false);
    }
  };

  const handleSttConvert = async () => {
    const sttFile = sttStore.sttFile();
    const uhabitsFile = sttStore.uhabitsFile();

    if (!sttFile || !uhabitsFile) {
      log('Missing required files', 'err');
      return;
    }

    const mappings = sttMappings();

    if (mappings.length === 0) {
      log('No valid mappings configured', 'err');
      return;
    }

    try {
      setProcessing(true);
      log('Starting conversion...', 'info');

      const blob = await convertSttToUHabits(
        sttFile,
        uhabitsFile,
        mappings,
        props.SQL
      );

      downloadFile(blob, 'uhabits_with_stt.backup', null);
      log('Conversion complete! Download started.', 'info');
    } catch (error: any) {
      log(`Conversion failed: ${error.message}`, 'err');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div class="container">
      <h1>npconv backup converter</h1>

      <ModeSelector mode={mode} setMode={handleModeChange} />

      <Show when={mode() === 'merge'}>
        <MergeControls onMerge={(dir, playlist) => processBackup(dir, playlist)} />
      </Show>

      <Show when={mode() === 'convert'}>
        <ConvertControls onConvert={(dir) => processBackup(dir)} />
      </Show>

      <Show when={mode() === 'stt'}>
        <SttControls 
          disabled={processing()} 
          sttStore={sttStore} 
          onConvert={handleSttConvert}
          onMappingsChange={setSttMappings}
        />
      </Show>

      <Show when={isNewPipeMode()}>
        <div id="global-options">
          <label for="include-watch-history">Include watch history:</label>
          <input
            type="checkbox"
            id="include-watch-history"
            checked={includeWatchHistory()}
            onChange={(e) => setIncludeWatchHistory(e.currentTarget.checked)}
          />
        </div>
      </Show>

      <section id="main-file-area" class="file-area">
        <FileZone
          id="zone-left"
          mode={mode}
          configs={leftFileConfigs}
          onFileChange={handleLeftFileChange}
        />
        <FileZone
          id="zone-right"
          mode={mode}
          configs={rightFileConfigs}
          onFileChange={handleRightFileChange}
        />
      </section>

      <DebugConsole />
    </div>
  );
};

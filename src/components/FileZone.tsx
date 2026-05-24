import type { Component, JSX } from 'solid-js';
import { createSignal, createEffect } from 'solid-js';
import { log } from '../logger';
import type { Mode } from './ModeSelector';

interface FileConfig {
  title: string;
  hint: string;
  accept: string;
}

interface Props {
  id: string;
  mode: () => Mode;
  onFileChange: (file: File | null) => void;
  configs: Record<Mode, FileConfig>;
}

export const FileZone: Component<Props> = (props) => {
  const [fileName, setFileName] = createSignal<string>('');
  let fileInputRef: HTMLInputElement | undefined;
  let prevModeType: 'newpipe' | 'stt' = 'newpipe';

  const config = () => props.configs[props.mode()];

  // Clear file when switching between converter types
  createEffect(() => {
    const currentMode = props.mode();
    const currentModeType = (currentMode === 'merge' || currentMode === 'convert') ? 'newpipe' : 'stt';
    
    if (prevModeType !== currentModeType) {
      if (fileInputRef) fileInputRef.value = '';
      setFileName('');
      props.onFileChange(null);
    }
    
    prevModeType = currentModeType;
  });

  const handleFileChange = (files: FileList | null) => {
    const file = files?.[0];
    
    if (file) {
      const allowedExts = config().accept.split(',').map(ext => ext.trim().toLowerCase());
      const fileNameLower = file.name.toLowerCase();
      const isValid = allowedExts.some(ext => fileNameLower.endsWith(ext));
      
      if (!isValid) {
        log(`Invalid file type. Expected: ${allowedExts.join(', ')}`, 'err');
        if (fileInputRef) fileInputRef.value = '';
        setFileName('');
        props.onFileChange(null);
        return;
      }
    }
    
    setFileName(file ? file.name : '');
    props.onFileChange(file || null);
  };

  return (
    <div
      class="drop-zone"
      id={props.id}
      role="button"
      tabindex="0"
      aria-label={`Select ${config().title}`}
      onClick={(e) => {
        if (e.target === fileInputRef || (e.target as HTMLElement).closest('.clear-file')) return;
        fileInputRef?.click();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInputRef?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add('active');
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove('active');
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('active');
        const files = e.dataTransfer?.files;
        if (files && files.length && fileInputRef) {
          try {
            const dt = new DataTransfer();
            for (let i = 0; i < files.length; i++) dt.items.add(files[i]);
            fileInputRef.files = dt.files;
            handleFileChange(dt.files);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            log(`Could not set input.files programmatically: ${errorMsg}`, 'err');
          }
        }
      }}
    >
      <button
        class="clear-file remove-button"
        aria-label="Clear file"
        style={{ display: fileName() ? 'flex' : 'none' }}
        onClick={(e) => {
          e.stopPropagation();
          if (fileInputRef) fileInputRef.value = '';
          setFileName('');
          props.onFileChange(null);
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
          <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
      
      <h4 class="zone-title">{config().title}</h4>
      <p>
        <small class="hint zone-hint" innerHTML={config().hint} />
      </p>
      
      <input
        ref={fileInputRef}
        type="file"
        accept={config().accept}
        onChange={(e) => handleFileChange(e.currentTarget.files)}
      />
      
      <div class="file-name" aria-live="polite">
        {fileName()}
      </div>
    </div>
  );
};

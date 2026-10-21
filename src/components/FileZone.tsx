import type { Component } from 'solid-js';
import { createSignal, createEffect, Show } from 'solid-js';
import { log } from '../logger';

interface FileConfig {
  title: string;
  hint: string;
  accept: string;
}

interface Props {
  id: string;
  resetKey: string;
  config: FileConfig;
  onFileChange: (file: File | null) => void;
}

/** Accept backup files by selection or drop and clear the displayed upload when its file group changes. */
export const FileZone: Component<Props> = (props) => {
  const [fileName, setFileName] = createSignal<string>('');
  let fileInputRef: HTMLInputElement | undefined;
  let previousResetKey = props.resetKey;

  const config = () => props.config;

  createEffect(() => {
    const resetKey = props.resetKey;
    
    if (previousResetKey !== resetKey) {
      if (fileInputRef) fileInputRef.value = '';
      setFileName('');
    }
    
    previousResetKey = resetKey;
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
      classList={{ 'has-file': !!fileName() }}
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
      
      <div class="zone-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <Show
            when={fileName()}
            fallback={<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />}
          >
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5m-9.5 6 2 2 3.5-4" />
          </Show>
        </svg>
      </div>

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

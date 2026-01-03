import { createSignal } from 'solid-js';
import type { SqlJsStatic } from 'sql.js';
import type { ParsedSttBackup } from '../types/stt';
import type { ParsedUHabitsBackup } from '../types/uhabits';
import { parseSttBackup } from '../converters/stt-uhabits/sttParser';
import { parseUHabitsBackup } from '../converters/stt-uhabits/uhabitsHelper';
import { log } from '../logger';

export function createSttStore(SQL: SqlJsStatic) {
  const [sttData, setSttData] = createSignal<ParsedSttBackup | null>(null);
  const [uhabitsData, setUhabitsData] = createSignal<ParsedUHabitsBackup | null>(null);
  const [sttFile, setSttFile] = createSignal<File | null>(null);
  const [uhabitsFile, setUhabitsFile] = createSignal<File | null>(null);
  
  let currentOperationId = 0;

  const loadSttFile = async (file: File) => {
    try {
      const data = await parseSttBackup(file);
      setSttData(data);
      setSttFile(file);
      log(`Loaded ${data.recordTypes.size} STT activity types`, 'info');
      return true;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`Error loading STT file: ${errorMsg}`, 'err');
      setSttData(null);
      setSttFile(null);
      return false;
    }
  };

  const loadUHabitsFile = async (file: File) => {
    // Generate unique operation ID to detect races
    const operationId = ++currentOperationId;
    
    // Capture previous DB to close after successful replacement
    const prevData = uhabitsData();
    const prevDb = prevData?.db;
    
    let newData: ParsedUHabitsBackup | null = null;
    
    try {
      newData = await parseUHabitsBackup(file, SQL);
      
      // Check if this operation is still the latest
      if (operationId !== currentOperationId) {
        // Another operation started, close our DB and abort
        if (newData?.db) newData.db.close();
        return false;
      }
      
      // Safe to update state - we're still the latest operation
      setUhabitsData(newData);
      setUhabitsFile(file);
      
      // Close previous DB only after successful state update
      if (prevDb) prevDb.close();
      
      log(`Loaded ${newData.allHabits.size} habits (${newData.booleanHabits.size} boolean)`, 'info');
      return true;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`Error loading uHabits file: ${errorMsg}`, 'err');
      
      // On error, close only the DB we created (if any)
      if (newData?.db) newData.db.close();
      
      // Only clear state if we're still the latest operation
      if (operationId === currentOperationId) {
        // Close the currently stored DB if it matches what we captured
        const currentData = uhabitsData();
        if (currentData?.db === prevDb) {
          prevDb?.close();
        }
        setUhabitsData(null);
        setUhabitsFile(null);
      }
      
      return false;
    }
  };

  return {
    sttData,
    uhabitsData,
    sttFile,
    uhabitsFile,
    loadSttFile,
    loadUHabitsFile,
  };
}

export type SttStore = ReturnType<typeof createSttStore>;

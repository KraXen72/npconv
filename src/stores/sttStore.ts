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

  const loadSttFile = async (file: File) => {
    try {
      const data = await parseSttBackup(file);
      setSttData(data);
      setSttFile(file);
      log(`Loaded ${data.recordTypes.size} STT activity types`, 'info');
      return true;
    } catch (error: any) {
      log(`Error loading STT file: ${error.message}`, 'err');
      setSttData(null);
      setSttFile(null);
      return false;
    }
  };

  const loadUHabitsFile = async (file: File) => {
    try {
      // Close previous database if exists
      const prevData = uhabitsData();
      if (prevData?.db) prevData.db.close();

      const data = await parseUHabitsBackup(file, SQL);
      setUhabitsData(data);
      setUhabitsFile(file);
      log(`Loaded ${data.allHabits.size} habits (${data.booleanHabits.size} boolean)`, 'info');
      return true;
    } catch (error: any) {
      log(`Error loading uHabits file: ${error.message}`, 'err');
      const prevData = uhabitsData();
      if (prevData?.db) prevData.db.close();
      setUhabitsData(null);
      setUhabitsFile(null);
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

import type { SqlJsStatic } from 'sql.js';
import type { ConversionMapping } from '../../schemas/uhabits';
import { parseSttBackup, filterRecordsByDuration, groupRecordsByDay, getRecordsForType } from './sttParser';
import { parseUHabitsBackup, exportUHabitsBackup } from './uhabitsHelper';
import { log } from '../../logger';
import { importMappedDays } from '../shared/mappedUHabitsImport';

/**
 * Convert Simple Time Tracker records to uHabits habit entries.
 */
export async function convertSttToUHabits(
	sttFile: File,
	uhabitsFile: File,
	mappings: ConversionMapping[],
	SQL: SqlJsStatic
): Promise<Blob> {
	log('Starting STT → uHabits conversion', 'info');

	const sttData = await parseSttBackup(sttFile);
	log(`Loaded ${sttData.recordTypes.size} activities, ${sttData.records.length} records`, 'info');

	const uhabits = await parseUHabitsBackup(uhabitsFile, SQL);
	const { db } = uhabits;

	try {
		const inserted = importMappedDays(db, uhabits, mappings, mapping => {
			const sttType = sttData.recordTypes.get(mapping.sourceId);
			if (!sttType) return null;
			const records = getRecordsForType(
				filterRecordsByDuration(sttData.records, mapping.minDuration ?? 0),
				mapping.sourceId
			);
			return {
				label: `${sttType.emoji} ${sttType.name}`.trim(),
				days: [...groupRecordsByDay(records)].map(([dayKey, dayRecords]) => ({
					dayKey,
					notes: dayRecords.map(record => record.comment ?? '').filter(Boolean)
				}))
			};
		});

		log(`Conversion complete: ${inserted} new repetitions added`, 'info');

		const dbData = exportUHabitsBackup(db);
		return new Blob([dbData as any], { type: 'application/x-sqlite3' });
	} finally {
		db.close();
	}
}

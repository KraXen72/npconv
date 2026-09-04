import type { SqlJsStatic } from 'sql.js';
import type { ConversionMapping } from '../../schemas/uhabits';
import { log } from '../../logger';
import { parseUHabitsBackup, exportUHabitsBackup } from '../stt-uhabits/uhabitsHelper';
import { importMappedDays } from '../shared/mappedUHabitsImport';
import { parseTimeJotBackup } from './timejotParser';

export async function convertTimeJotToUHabits(
	timeJotFile: File,
	uhabitsFile: File,
	mappings: ConversionMapping[],
	SQL: SqlJsStatic
): Promise<Blob> {
	log('Starting TimeJot → uHabits conversion', 'info');
	const timeJot = await parseTimeJotBackup(timeJotFile, SQL);
	const uhabits = await parseUHabitsBackup(uhabitsFile, SQL);
	const { db } = uhabits;

	try {
		const inserted = importMappedDays(db, uhabits, mappings, mapping => {
			const event = timeJot.events.get(mapping.sourceId);
			if (!event) return null;
			return {
				label: event.title,
				days: timeJot.entries
					.filter(entry => entry.eventId === event.id)
					.map(entry => ({ dayKey: entry.dayKey, notes: entry.note ? [entry.note] : [] }))
			};
		});

		log(`Conversion complete: ${inserted} new repetitions added`, 'info');
		const data = exportUHabitsBackup(db);
		return new Blob([data as any], { type: 'application/x-sqlite3' });
	} finally {
		db.close();
	}
}

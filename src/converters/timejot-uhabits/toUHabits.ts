import type { SqlJsStatic } from 'sql.js';
import type { ConversionMapping } from '../../schemas/uhabits';
import { log } from '../../logger';
import { parseUHabitsBackup, timestampToDayKey, exportUHabitsBackup } from '../stt-uhabits/uhabitsHelper';
import { importMappedDays } from '../shared/mappedUHabitsImport';
import { invertTimeJotDays, parseTimeJotBackup, timeJotDayKey } from './timejotParser';

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
			const target = uhabits.allHabits.get(mapping.uhabitsHabitId);
			if (!event || !target) return null;

			const entries = timeJot.entries.filter(entry => entry.eventId === event.id);
			const entriesByDay = new Map<string, string[]>();
			for (const entry of entries) {
				const dayKey = timeJotDayKey(entry.date, mapping.timeJotRolloverHours ?? 0);
				const notes = entriesByDay.get(dayKey) ?? [];
				if (entry.note) notes.push(entry.note);
				entriesByDay.set(dayKey, notes);
			}

			const recordedDays = new Set(entriesByDay.keys());
			const existingTargetDays = new Set(
				uhabits.repetitions
					.filter(repetition => repetition.habit_id === target.id)
					.map(repetition => timestampToDayKey(repetition.timestamp))
			);
			const dayKeys = mapping.invertTimeJot && target.type === 0
				? invertTimeJotDays(recordedDays, existingTargetDays)
				: recordedDays;

			return {
				label: event.title,
				days: [...dayKeys].map(dayKey => ({
					dayKey,
					notes: entriesByDay.get(dayKey) ?? []
				}))
			};
		});

		log(`Conversion complete: ${inserted} new repetitions added`, 'info');
		const data = exportUHabitsBackup(db);
		return new Blob([data as any], { type: 'application/x-sqlite3' });
	} finally {
		db.close();
	}
}

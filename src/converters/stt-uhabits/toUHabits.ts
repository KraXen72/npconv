import type { SqlJsStatic } from 'sql.js';
import type { ConversionMapping } from '../../types/uhabits';
import { parseSttBackup, filterRecordsByDuration, groupRecordsByDay, getRecordsForType } from './sttParser';
import { parseUHabitsBackup, timestampToDayStart, exportUHabitsBackup } from './uhabitsHelper';
import { log } from '../../logger';

/**
 * Convert Simple Time Tracker records to uHabits boolean habit entries
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
	
	const { db, allHabits, booleanHabits, repetitions } = await parseUHabitsBackup(uhabitsFile, SQL);
	log(`Loaded ${allHabits.size} habits, ${repetitions.length} repetitions`, 'info');
	
	// Build set of existing repetitions for deduplication
	// This prevents duplicates when multiple STT activities map to the same uHabits habit,
	// or when a day already has a repetition in the uHabits backup
	const existingReps = new Set<string>();
	for (const rep of repetitions) {
		existingReps.add(`${rep.habit_id}:${rep.timestamp}`);
	}
	
	// Process each mapping and collect new repetitions
	// Note: Multiple STT activities can map to the same uHabits habit.
	// The existingReps Set ensures no duplicate repetitions are created for the same habit+day.
	const newRepetitions: Array<{ habitId: number, timestamp: number, notes: string }> = [];
	const mappingStats: Array<{ name: string, newCount: number, skippedCount: number }> = [];
	
	for (const mapping of mappings) {
		const sttType = sttData.recordTypes.get(mapping.sttTypeId);
		const uhabit = booleanHabits.get(mapping.uhabitsHabitId);
		
		if (!sttType || !uhabit) {
			log(`Skipping invalid mapping`, 'warn');
			continue;
		}
		
		const minDuration = mapping.minDuration || 0;
		const filteredRecords = filterRecordsByDuration(sttData.records, minDuration);
		const typeRecords = getRecordsForType(filteredRecords, mapping.sttTypeId);
		
		if (typeRecords.length === 0) continue;
		
		const dayGroups = groupRecordsByDay(typeRecords);
		let newCount = 0;
		let skippedCount = 0;
		
		for (const [dayStr, dayRecords] of dayGroups) {
			const dayTimestamp = timestampToDayStart(dayRecords[0].start_timestamp);
			const key = `${mapping.uhabitsHabitId}:${dayTimestamp}`;
			
			if (existingReps.has(key)) {
				skippedCount++;
				continue;
			}
			
			const totalDurationMs = dayRecords.reduce((sum, r) => 
				sum + (r.end_timestamp - r.start_timestamp), 0
			);
			const totalMinutes = Math.round(totalDurationMs / 60000);
			
			let notes = '';
			if (mapping.copySttComments) {
				const comments = dayRecords
					.map(r => r.comment)
					.filter((c): c is string => !!c && c.trim().length > 0);
				if (comments.length > 0) {
					notes = [...new Set(comments)].join('; ');
				}
			}
			
			newRepetitions.push({ habitId: mapping.uhabitsHabitId, timestamp: dayTimestamp, notes });
			existingReps.add(key);
			newCount++;
		}
		
		mappingStats.push({ 
			name: `"${sttType.emoji} ${sttType.name}" -> "${uhabit.name}"`, 
			newCount, 
			skippedCount 
		});
	}
	
	// Sort new repetitions by timestamp before inserting
	newRepetitions.sort((a, b) => a.timestamp - b.timestamp);
	
	// Insert all new repetitions in sorted order
	for (const rep of newRepetitions) {
		db.run(`
			INSERT INTO Repetitions (habit, timestamp, value, notes)
			VALUES (?, ?, ?, ?)
		`, [rep.habitId, rep.timestamp, 2, rep.notes]);
	}
	
	// Log results
	for (const stat of mappingStats) {
		log(`${stat.name}: +${stat.newCount}${stat.skippedCount > 0 ? ` (${stat.skippedCount} skipped)` : ''}`, 'info');
	}
	
	log(`Conversion complete: ${newRepetitions.length} new repetitions added`, 'info');
	
	const dbData = exportUHabitsBackup(db);
	db.close();
	
	return new Blob([dbData as any], { type: 'application/x-sqlite3' });
}

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
	SQL: SqlJsStatic,
	fillRepetitionNotes: boolean = true
): Promise<Blob> {
	log('=== Starting STT → uHabits Conversion ===', 'info');
	log(`Number of mappings: ${mappings.length}`, 'info');
	
	// Parse STT backup
	const sttData = await parseSttBackup(sttFile);
	log(`Loaded ${sttData.recordTypes.size} STT activity types`, 'info');
	log(`Loaded ${sttData.records.length} total STT records`, 'info');
	
	// Parse uHabits backup - this also loads the database
	const { db, allHabits, booleanHabits, repetitions } = await parseUHabitsBackup(uhabitsFile, SQL);
	log(`Loaded ${allHabits.size} total habits`, 'info');
	log(`Loaded ${repetitions.length} existing repetitions`, 'info');
	
	// Build set of existing repetitions for deduplication
	// This prevents duplicates when multiple STT activities map to the same uHabits habit,
	// or when a day already has a repetition in the uHabits backup
	const existingReps = new Set<string>();
	for (const rep of repetitions) {
		existingReps.add(`${rep.habit_id}:${rep.timestamp}`);
	}
	
	// Process each mapping
	// Note: Multiple STT activities can map to the same uHabits habit.
	// The existingReps Set ensures no duplicate repetitions are created for the same habit+day.
	let totalNewReps = 0;
	
	for (const mapping of mappings) {
		const sttType = sttData.recordTypes.get(mapping.sttTypeId);
		const uhabit = booleanHabits.get(mapping.uhabitsHabitId);
		
		if (!sttType) {
			log(`Warning: STT activity type ${mapping.sttTypeId} not found`, 'warn');
			continue;
		}
		
		if (!uhabit) {
			log(`Warning: uHabits habit ${mapping.uhabitsHabitId} not found`, 'warn');
			continue;
		}
		
		log(`Processing mapping: "${sttType.emoji} ${sttType.name}" → "${uhabit.name}"`, 'info');
		
		// Apply per-mapping duration filter
		const minDuration = mapping.minDuration || 0;
		if (minDuration > 0) {
			log(`  Minimum duration: ${minDuration} minutes`, 'info');
		}
		const filteredRecords = filterRecordsByDuration(sttData.records, minDuration);
		
		// Filter records for this specific activity type
		const typeRecords = getRecordsForType(filteredRecords, mapping.sttTypeId);
		log(`  Found ${typeRecords.length} records for this activity`, 'info');
		
		if (typeRecords.length === 0) {
			log(`  No records to convert`, 'info');
			continue;
		}
		
		// Group by day (multiple records in same day = one habit checkmark)
		const dayGroups = groupRecordsByDay(typeRecords);
		log(`  Records span ${dayGroups.size} unique days`, 'info');
		
		let newCount = 0;
		let skippedCount = 0;
		
		for (const [dayStr, dayRecords] of dayGroups) {
			// Use midnight of the day from first record's start time
			const dayTimestamp = timestampToDayStart(dayRecords[0].start_timestamp);
			const key = `${mapping.uhabitsHabitId}:${dayTimestamp}`;
			
			// Skip if already exists
			if (existingReps.has(key)) {
				skippedCount++;
				continue;
			}
			
			// Calculate total duration for this day
			const totalDurationMs = dayRecords.reduce((sum, r) => 
				sum + (r.end_timestamp - r.start_timestamp), 0
			);
			const totalMinutes = Math.round(totalDurationMs / 60000);
			
			// Insert new repetition (value=2 means checked)
			const notes = fillRepetitionNotes
				? `Converted from STT: ${dayRecords.length} session${dayRecords.length > 1 ? 's' : ''}, ${totalMinutes}min total`
				: null;
			
			db.run(`
				INSERT INTO Repetitions (habit, timestamp, value, notes)
				VALUES (?, ?, ?, ?)
			`, [mapping.uhabitsHabitId, dayTimestamp, 2, notes]);
			
			existingReps.add(key);
			newCount++;
			totalNewReps++;
		}
		
		log(`Added ${newCount} new repetitions`, 'info');
		if (skippedCount > 0) {
			log(`Skipped ${skippedCount} existing days`, 'warn');
		}
	}
	
	// Export database
	log('=== Conversion Complete ===', 'info');
	log(`Total new repetitions added: ${totalNewReps}`, 'info');
	log('Exporting database...', 'info');
	
	const dbData = exportUHabitsBackup(db);
	db.close();
	
	return new Blob([dbData as any], { type: 'application/x-sqlite3' });
}

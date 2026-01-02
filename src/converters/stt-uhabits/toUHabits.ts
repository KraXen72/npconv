import type { SqlJsStatic } from 'sql.js';
import type { ConversionMapping } from '../../types/uhabits';
import { parseSttBackup, filterRecordsByDuration, groupRecordsByDay, getRecordsForType } from './sttParser';
import { parseUHabitsBackup, createUHabitsDatabase, timestampToDayStart, exportUHabitsBackup } from './uhabitsHelper';
import { log } from '../../logger';

/**
 * Convert Simple Time Tracker records to uHabits boolean habit entries
 */
export async function convertSttToUHabits(
	sttFile: File,
	uhabitsFile: File,
	mappings: ConversionMapping[],
	minDurationMinutes: number,
	SQL: SqlJsStatic
): Promise<Blob> {
	log('=== Starting STT → uHabits Conversion ===', 'info');
	log(`Minimum duration filter: ${minDurationMinutes} minutes`, 'info');
	log(`Number of mappings: ${mappings.length}`, 'info');
	
	// Parse STT backup
	const sttData = await parseSttBackup(sttFile);
	log(`Loaded ${sttData.recordTypes.size} STT activity types`, 'info');
	log(`Loaded ${sttData.records.length} total STT records`, 'info');
	
	// Parse uHabits backup
	const uhabitsData = await parseUHabitsBackup(uhabitsFile, SQL);
	log(`Loaded ${uhabitsData.habits.size} uHabits habits (boolean only)`, 'info');
	log(`Loaded ${uhabitsData.repetitions.length} existing repetitions`, 'info');
	
	// Filter by duration
	const filteredRecords = filterRecordsByDuration(sttData.records, minDurationMinutes);
	log(`After duration filter: ${filteredRecords.length} records`, 'info');
	
	// Create output database with existing schema
	const db = createUHabitsDatabase(SQL);
	
	// Copy existing habits
	log('Copying existing habits to new database...', 'info');
	for (const [id, habit] of uhabitsData.habits) {
		db.run(`
			INSERT INTO Habits (
				id, name, question, color, archived, type, 
				freq_num, freq_den, position, description, uuid, highlight, 
				reminder_hour, reminder_min, reminder_days, 
				target_type, target_value, unit
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			habit.id, habit.name, habit.question, habit.color, habit.archived, habit.type,
			habit.freq_num, habit.freq_den, habit.position, habit.description || null,
			habit.uuid || null, habit.highlight, habit.reminder_hour, habit.reminder_min,
			habit.reminder_days, habit.target_type, habit.target_value, habit.unit
		]);
	}
	
	// Build set of existing repetitions for deduplication
	const existingReps = new Set<string>();
	log('Copying existing repetitions to new database...', 'info');
	for (const rep of uhabitsData.repetitions) {
		db.run(`
			INSERT INTO Repetitions (habit, timestamp, value, notes)
			VALUES (?, ?, ?, ?)
		`, [rep.habit_id, rep.timestamp, rep.value, rep.notes || null]);
		
		existingReps.add(`${rep.habit_id}:${rep.timestamp}`);
	}
	
	// Process each mapping
	let totalNewReps = 0;
	
	for (const mapping of mappings) {
		const sttType = sttData.recordTypes.get(mapping.sttTypeId);
		const uhabit = uhabitsData.habits.get(mapping.uhabitsHabitId);
		
		if (!sttType) {
			log(`Warning: STT activity type ${mapping.sttTypeId} not found`, 'warn');
			continue;
		}
		
		if (!uhabit) {
			log(`Warning: uHabits habit ${mapping.uhabitsHabitId} not found`, 'warn');
			continue;
		}
		
		log(`\nProcessing mapping: "${sttType.emoji} ${sttType.name}" → "${uhabit.name}"`, 'info');
		
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
			const notes = `Converted from STT: ${dayRecords.length} session${dayRecords.length > 1 ? 's' : ''}, ${totalMinutes}min total`;
			
			db.run(`
				INSERT INTO Repetitions (habit, timestamp, value, notes)
				VALUES (?, ?, ?, ?)
			`, [mapping.uhabitsHabitId, dayTimestamp, 2, notes]);
			
			existingReps.add(key);
			newCount++;
			totalNewReps++;
		}
		
		log(`  ✓ Added ${newCount} new repetitions`, 'info');
		if (skippedCount > 0) {
			log(`  ⊘ Skipped ${skippedCount} existing days`, 'info');
		}
	}
	
	// Update sqlite_sequence for autoincrement
	const maxHabitId = Math.max(...Array.from(uhabitsData.habits.keys()), 0);
	const maxRepId = uhabitsData.repetitions.length > 0 
		? Math.max(...uhabitsData.repetitions.map(r => r.id))
		: 0;
	
	db.run(`INSERT INTO sqlite_sequence (name, seq) VALUES ('Habits', ?)`, [maxHabitId]);
	db.run(`INSERT INTO sqlite_sequence (name, seq) VALUES ('Repetitions', ?)`, [maxRepId + totalNewReps]);
	
	// Export database
	log('\n=== Conversion Complete ===', 'info');
	log(`Total new repetitions added: ${totalNewReps}`, 'info');
	log('Exporting database...', 'info');
	
	const dbData = exportUHabitsBackup(db);
	db.close();
	
	return new Blob([dbData as any], { type: 'application/x-sqlite3' });
}

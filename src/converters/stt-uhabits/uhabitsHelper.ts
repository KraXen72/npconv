import type { Database, SqlJsStatic } from 'sql.js';
import type { ParsedUHabitsBackup, UHabitsHabit, UHabitsRepetition } from '../../types/uhabits';
import { log } from '../../logger';

/**
 * Parse uHabits SQLite backup file and return the loaded database
 */
export async function parseUHabitsBackup(file: File, SQL: SqlJsStatic): Promise<ParsedUHabitsBackup> {
	log('Parsing uHabits backup file...', 'info');
	
	const arrayBuffer = await file.arrayBuffer();
	const db = new SQL.Database(new Uint8Array(arrayBuffer));
	
	const allHabits = new Map<number, UHabitsHabit>();
	const booleanHabits = new Map<number, UHabitsHabit>();
	const repetitions: UHabitsRepetition[] = [];
	
	try {
		// Read Habits table - ALL habits to preserve them in output
		const habitsQuery = db.exec(`
			SELECT id, archived, color, description, freq_den, freq_num, highlight, 
			       name, position, reminder_hour, reminder_min, reminder_days, 
			       type, target_type, target_value, unit, question, uuid
			FROM Habits
		`);
		
		if (habitsQuery.length > 0) {
			const rows = habitsQuery[0].values;
			for (const row of rows) {
				const habit: UHabitsHabit = {
					id: row[0] as number,
					archived: row[1] as number,
					color: row[2] as number,
					description: row[3] as string | undefined,
					freq_den: row[4] as number,
					freq_num: row[5] as number,
					highlight: row[6] as number,
					name: row[7] as string,
					position: row[8] as number,
					reminder_hour: row[9] as number,
					reminder_min: row[10] as number,
					reminder_days: row[11] as number,
					type: row[12] as number,
					target_type: row[13] as number,
					target_value: row[14] as number,
					unit: row[15] as string,
					question: row[16] as string,
					uuid: row[17] as string | undefined
				};
				allHabits.set(habit.id, habit);
				// Only add boolean habits (type=0) to the UI selection map
				if (habit.type === 0) {
					booleanHabits.set(habit.id, habit);
				}
			}
			log(`Loaded ${allHabits.size} total habits (${booleanHabits.size} boolean, ${allHabits.size - booleanHabits.size} non-boolean)`, 'info');
		}
		
		// Read Repetitions table
		const repsQuery = db.exec(`
			SELECT id, habit, timestamp, value, notes
			FROM Repetitions
		`);
		
		if (repsQuery.length > 0) {
			const rows = repsQuery[0].values;
			for (const row of rows) {
				repetitions.push({
					id: row[0] as number,
					habit_id: row[1] as number,
					timestamp: row[2] as number,
					value: row[3] as number,
					notes: row[4] as string | undefined
				});
			}
			log(`Loaded ${repetitions.length} repetitions from uHabits`, 'info');
		}
		
	} catch (error) {
		db.close();
		throw error;
	}
	
	// Return the database object along with parsed data (caller is responsible for closing)
	return { db, allHabits, booleanHabits, repetitions };
}

/**
 * Convert timestamp to day start (midnight)
 */
export function timestampToDayStart(timestampMs: number): number {
	const date = new Date(timestampMs);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

/**
 * Export uHabits database as binary data
 */
export function exportUHabitsBackup(db: Database): Uint8Array {
	return db.export();
}

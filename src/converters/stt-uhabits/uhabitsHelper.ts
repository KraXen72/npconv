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
			for (const row of habitsQuery[0].values) {
				// Validate row has expected number of columns
				if (row.length < 18) {
					log(`Skipping malformed habit row with ${row.length} columns`, 'warn');
					continue;
				}
				
				// Parse and validate required fields
				const id = Number(row[0]);
				const name = String(row[7] ?? '');
				const question = String(row[16] ?? '');
				const type = Number(row[12]);
				
				if (!Number.isFinite(id) || !name) {
					log(`Skipping habit with invalid id or name`, 'warn');
					continue;
				}
				
				const habit: UHabitsHabit = {
					id,
					archived: Number(row[1]),
					color: Number(row[2]),
					description: row[3] !== null ? String(row[3]) : undefined,
					freq_den: Number(row[4]),
					freq_num: Number(row[5]),
					highlight: Number(row[6]),
					name,
					position: Number(row[8]),
					reminder_hour: Number(row[9]),
					reminder_min: Number(row[10]),
					reminder_days: Number(row[11]),
					type,
					target_type: Number(row[13]),
					target_value: Number(row[14]),
					unit: String(row[15] ?? ''),
					question,
					uuid: row[17] !== null ? String(row[17]) : undefined
				};
				allHabits.set(habit.id, habit);
				if (habit.type === 0) booleanHabits.set(habit.id, habit);
			}
			log(`Loaded ${allHabits.size} habits (${booleanHabits.size} boolean)`, 'info');
		}
		
		// Read Repetitions table
		const repsQuery = db.exec(`SELECT id, habit, timestamp, value, notes FROM Repetitions`);
		
		if (repsQuery.length > 0) {
			for (const row of repsQuery[0].values) {
				// Validate row has expected number of columns
				if (row.length < 5) {
					log(`Skipping malformed repetition row with ${row.length} columns`, 'warn');
					continue;
				}
				
				const id = Number(row[0]);
				const habit_id = Number(row[1]);
				const timestamp = Number(row[2]);
				const value = Number(row[3]);
				
				if (!Number.isFinite(id) || !Number.isFinite(habit_id) || !Number.isFinite(timestamp)) {
					log(`Skipping repetition with invalid id/habit_id/timestamp`, 'warn');
					continue;
				}
				
				repetitions.push({
					id,
					habit_id,
					timestamp,
					value,
					notes: row[4] !== null ? String(row[4]) : undefined
				});
			}
			log(`Loaded ${repetitions.length} repetitions`, 'info');
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

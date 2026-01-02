import type { Database, SqlJsStatic } from 'sql.js';
import type { ParsedUHabitsBackup, UHabitsHabit, UHabitsRepetition } from '../../types/uhabits';
import { log } from '../../logger';

/**
 * Parse uHabits SQLite backup file
 */
export async function parseUHabitsBackup(file: File, SQL: SqlJsStatic): Promise<ParsedUHabitsBackup> {
	log('Parsing uHabits backup file...', 'info');
	
	const arrayBuffer = await file.arrayBuffer();
	const db = new SQL.Database(new Uint8Array(arrayBuffer));
	
	const habits = new Map<number, UHabitsHabit>();
	const repetitions: UHabitsRepetition[] = [];
	
	try {
		// Read Habits table - only boolean habits (type=0) that aren't archived
		const habitsQuery = db.exec(`
			SELECT id, archived, color, description, freq_den, freq_num, highlight, 
			       name, position, reminder_hour, reminder_min, reminder_days, 
			       type, target_type, target_value, unit, question, uuid
			FROM Habits 
			WHERE type = 0 AND archived = 0
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
				habits.set(habit.id, habit);
			}
			log(`Loaded ${habits.size} boolean habits from uHabits`, 'info');
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
		
	} finally {
		db.close();
	}
	
	return { habits, repetitions };
}

/**
 * Create a new uHabits database with schema
 */
export function createUHabitsDatabase(SQL: SqlJsStatic): Database {
	const db = new SQL.Database();
	
	// Create Habits table
	db.run(`
		CREATE TABLE Habits (
			id integer primary key autoincrement,
			archived integer,
			color integer,
			description text,
			freq_den integer,
			freq_num integer,
			highlight integer,
			name text,
			position integer,
			reminder_hour integer,
			reminder_min integer,
			reminder_days integer not null default 127,
			type integer not null default 0,
			target_type integer not null default 0,
			target_value real not null default 0,
			unit text not null default "",
			question text,
			uuid text
		)
	`);
	
	// Create Repetitions table
	db.run(`
		CREATE TABLE Repetitions (
			id integer primary key autoincrement,
			habit integer not null references habits(id),
			timestamp integer not null,
			value integer not null,
			notes text
		)
	`);
	
	// Create unique index
	db.run(`
		CREATE UNIQUE INDEX idx_repetitions_habit_timestamp 
		ON Repetitions(habit, timestamp)
	`);
	
	// Create android_metadata table (required by uHabits)
	db.run(`CREATE TABLE android_metadata (locale TEXT)`);
	db.run(`INSERT INTO android_metadata VALUES ('en_US')`);
	
	// Create sqlite_sequence table (for autoincrement)
	db.run(`CREATE TABLE sqlite_sequence(name, seq)`);
	
	log('Created uHabits database schema', 'info');
	
	return db;
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

/**
 * Get default color for new habits (uHabits purple)
 */
export function getDefaultHabitColor(): number {
	// uHabits uses integer colors, 13 is typically a purple/blue shade
	return 13;
}

/**
 * Generate a unique habit question from name
 */
export function generateHabitQuestion(name: string): string {
	return `Did you ${name.toLowerCase()}?`;
}

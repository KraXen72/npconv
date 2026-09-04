import type { Database, SqlJsStatic } from 'sql.js';
import type { ParsedUHabitsBackup, UHabitsHabit, UHabitsRepetition } from '../../schemas/uhabits';
import { log } from '../../logger';
import { selectHabits, selectRepetitions } from '../../db/uhabitsRepo';

/**
 * Parse uHabits SQLite backup file and return the loaded database
 */
export async function parseUHabitsBackup(file: File, SQL: SqlJsStatic): Promise<ParsedUHabitsBackup> {
	log('Parsing uHabits backup file...', 'info');

	const arrayBuffer = await file.arrayBuffer();
	const db = new SQL.Database(new Uint8Array(arrayBuffer));

	const allHabits = new Map<number, UHabitsHabit>();
	const booleanHabits = new Map<number, UHabitsHabit>();
	const numericHabits = new Map<number, UHabitsHabit>();
	const repetitions: UHabitsRepetition[] = [];

	try {
		for (const habit of selectHabits(db)) {
			allHabits.set(habit.id, habit);
			if (habit.type === 0) booleanHabits.set(habit.id, habit);
			if (habit.type === 1) numericHabits.set(habit.id, habit);
		}
		log(`Loaded ${allHabits.size} habits (${booleanHabits.size} boolean, ${numericHabits.size} numeric)`, 'info');

		repetitions.push(...selectRepetitions(db));
		log(`Loaded ${repetitions.length} repetitions`, 'info');

	} catch (error) {
		db.close();
		throw error;
	}

	// Return the database object along with parsed data (caller is responsible for closing)
	return { db, allHabits, booleanHabits, numericHabits, repetitions };
}

/**
 * Convert timestamp to day start (midnight)
 */
export function timestampToDayStart(timestampMs: number): number {
	const date = new Date(timestampMs);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dayKeyToTimestamp(dayKey: string): number {
	const [year, month, day] = dayKey.split('-').map(Number);
	return Date.UTC(year, month - 1, day);
}

export function timestampToDayKey(timestampMs: number): string {
	return new Date(timestampToDayStart(timestampMs)).toISOString().slice(0, 10);
}

/**
 * Export uHabits database as binary data
 */
export function exportUHabitsBackup(db: Database): Uint8Array {
	return db.export();
}

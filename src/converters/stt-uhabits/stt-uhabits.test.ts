import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { convertSttToUHabits } from './toUHabits';

let SQL: SqlJsStatic;

const fileFromBytes = (bytes: Uint8Array, name: string) => ({
	name,
	arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}) as File;

const fileFromText = (text: string, name: string) => ({
	name,
	text: async () => text
}) as File;

function addHabit(db: Database, id: number, name: string, type: 0 | 1, unit = '') {
	db.run(`INSERT INTO Habits
		(id, archived, color, description, freq_den, freq_num, highlight, name, position,
		 reminder_hour, reminder_min, reminder_days, type, target_type, target_value, unit, question, uuid)
		VALUES (?, 0, 1, NULL, 1, 1, 0, ?, ?, 0, 0, 127, ?, 0, 1, ?, ?, NULL)`,
		[id, name, id, type, unit, `${name}?`]);
}

function makeUHabits(): Uint8Array {
	const db = new SQL.Database();
	db.run(`CREATE TABLE Habits (
		id INTEGER PRIMARY KEY, archived INTEGER NOT NULL, color INTEGER NOT NULL, description TEXT,
		freq_den INTEGER NOT NULL, freq_num INTEGER NOT NULL, highlight INTEGER NOT NULL, name TEXT NOT NULL,
		position INTEGER NOT NULL, reminder_hour INTEGER NOT NULL, reminder_min INTEGER NOT NULL,
		reminder_days INTEGER NOT NULL, type INTEGER NOT NULL, target_type INTEGER NOT NULL,
		target_value REAL NOT NULL, unit TEXT NOT NULL, question TEXT NOT NULL, uuid TEXT)`);
	db.run(`CREATE TABLE Repetitions (
		id INTEGER PRIMARY KEY AUTOINCREMENT, habit INTEGER NOT NULL, timestamp INTEGER NOT NULL,
		value INTEGER NOT NULL, notes TEXT)`);
	addHabit(db, 1, 'Boolean target', 0);
	addHabit(db, 2, 'Points target', 1, 'points');
	const bytes = db.export();
	db.close();
	return bytes;
}

function sttBackup(): string {
	const day1 = Date.UTC(2025, 5, 7, 10, 0);
	const day2 = Date.UTC(2025, 5, 8, 10, 0);
	return [
		'recordType\t1\tDeep work\t🧠\t0\t0',
		'recordType\t2\tExercise\t🏃\t0\t0',
		`record\t1\t1\t${day1}\t${day1 + 10 * 60_000}\tshort`,
		`record\t2\t1\t${day1 + 60 * 60_000}\t${day1 + 90 * 60_000}\tkeep this`,
		`record\t3\t1\t${day1 + 2 * 60 * 60_000}\t${day1 + 2 * 60 * 60_000 + 45 * 60_000}\tkeep this`,
		`record\t4\t1\t${day2}\t${day2 + 40 * 60_000}\tsecond day`,
		`record\t5\t2\t${day2 + 60 * 60_000}\t${day2 + 2 * 60 * 60_000}\trun`
	].join('\n');
}

beforeAll(async () => {
	SQL = await initSqlJs();
});

describe('Simple Time Tracker → Loop Habit Tracker', () => {
	test('keeps existing days, applies min duration, and deduplicates copied comments', async () => {
		const target = new SQL.Database(makeUHabits());
		target.run(
			'INSERT INTO Repetitions (habit, timestamp, value, notes) VALUES (1, ?, 2, ?)',
			[Date.UTC(2025, 5, 8), 'existing']
		);
		const targetBytes = target.export();
		target.close();

		const result = await convertSttToUHabits(
			fileFromText(sttBackup(), 'stt.backup'),
			fileFromBytes(targetBytes, 'habits.db'),
			[{ sourceId: 1, uhabitsHabitId: 1, minDuration: 20, copySourceNotes: true }],
			SQL
		);

		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value, notes FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([
			[Date.UTC(2025, 5, 7), 2, 'keep this'],
			[Date.UTC(2025, 5, 8), 2, 'existing']
		]);
		output.close();
	});

	test('sums numeric values when multiple STT mappings target the same habit and day', async () => {
		const result = await convertSttToUHabits(
			fileFromText(sttBackup(), 'stt.backup'),
			fileFromBytes(makeUHabits(), 'habits.db'),
			[
				{ sourceId: 1, uhabitsHabitId: 2, minDuration: 20, numericValue: 1.25 },
				{ sourceId: 2, uhabitsHabitId: 2, minDuration: 20, numericValue: 2 }
			],
			SQL
		);

		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 2 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([
			[Date.UTC(2025, 5, 7), 1250],
			[Date.UTC(2025, 5, 8), 3250]
		]);
		output.close();
	});
});

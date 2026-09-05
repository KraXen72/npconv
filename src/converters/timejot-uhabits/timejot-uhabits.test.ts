import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { parseTimeJotBackup } from './timejotParser';
import { convertTimeJotToUHabits } from './toUHabits';

let SQL: SqlJsStatic;
let timeJotBytes: Uint8Array;
let timeJotGapBytes: Uint8Array;
let timeJotTrackingGapBytes: Uint8Array;

const fileFrom = (bytes: Uint8Array, name: string) => ({
	name,
	arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}) as File;

function addHabit(db: Database, id: number, name: string, type: 0 | 1, unit = '') {
	db.run(`INSERT INTO Habits
		(id, archived, color, description, freq_den, freq_num, highlight, name, position,
		 reminder_hour, reminder_min, reminder_days, type, target_type, target_value, unit, question, uuid)
		VALUES (?, 0, 1, NULL, 1, 1, 0, ?, ?, 0, 0, 127, ?, 0, 1, ?, ?, NULL)`,
		[id, name, id, type, unit, `${name}?`]);
}

function makeUHabits(existingBooleanDays: number[] = []): Uint8Array {
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
	for (const timestamp of existingBooleanDays) {
		db.run('INSERT INTO Repetitions (habit, timestamp, value, notes) VALUES (1, ?, 2, ?)', [timestamp, 'existing']);
	}
	const bytes = db.export();
	db.close();
	return bytes;
}

function makeTimeJot(): Uint8Array {
	const db = new SQL.Database();
	db.run(`CREATE TABLE events (
		event_id INTEGER PRIMARY KEY, title TEXT NOT NULL, archived INTEGER NOT NULL)`);
	db.run(`CREATE TABLE entries (
		entry_id INTEGER PRIMARY KEY, note TEXT, fk_event_id INTEGER NOT NULL,
		creation_date TEXT NOT NULL, ongoing INTEGER NOT NULL)`);
	db.run("INSERT INTO events VALUES (2, 'event horizon', 0), (6, 'no sleep token', 0), (7, 'no cigarettes', 0)");
	db.run(`INSERT INTO entries VALUES
		(1, 'existing overlap', 6, '2025-06-07T10:05:00+02:00', 0),
		(2, NULL, 7, '2025-07-27T03:00:00+02:00', 0),
		(3, NULL, 2, '2025-08-01T20:54:00+02:00', 0),
		(4, 'still running', 2, '2025-08-02T20:54:00+02:00', 1)`);
	const bytes = db.export();
	db.close();
	return bytes;
}

function makeTimeJotWithGap(): Uint8Array {
	const db = new SQL.Database();
	db.run(`CREATE TABLE events (
		event_id INTEGER PRIMARY KEY, title TEXT NOT NULL, archived INTEGER NOT NULL)`);
	db.run(`CREATE TABLE entries (
		entry_id INTEGER PRIMARY KEY, note TEXT, fk_event_id INTEGER NOT NULL,
		creation_date TEXT NOT NULL, ongoing INTEGER NOT NULL)`);
	db.run("INSERT INTO events VALUES (1, 'negative habit', 0)");
	db.run(`INSERT INTO entries VALUES
		(1, NULL, 1, '2025-08-01T02:00:00+02:00', 0),
		(2, NULL, 1, '2025-08-03T10:00:00+02:00', 0)`);
	const bytes = db.export();
	db.close();
	return bytes;
}

function makeTimeJotWithTrackingGap(): Uint8Array {
	const db = new SQL.Database();
	db.run(`CREATE TABLE events (
		event_id INTEGER PRIMARY KEY, title TEXT NOT NULL, archived INTEGER NOT NULL)`);
	db.run(`CREATE TABLE entries (
		entry_id INTEGER PRIMARY KEY, note TEXT, fk_event_id INTEGER NOT NULL,
		creation_date TEXT NOT NULL, ongoing INTEGER NOT NULL)`);
	db.run("INSERT INTO events VALUES (1, 'negative habit', 0)");
	db.run(`INSERT INTO entries VALUES
		(1, NULL, 1, '2025-08-01T10:00:00+02:00', 0),
		(2, NULL, 1, '2025-08-03T10:00:00+02:00', 0)`);
	const bytes = db.export();
	db.close();
	return bytes;
}

beforeAll(async () => {
	SQL = await initSqlJs();
	timeJotBytes = makeTimeJot();
	timeJotGapBytes = makeTimeJotWithGap();
	timeJotTrackingGapBytes = makeTimeJotWithTrackingGap();
});

describe('TimeJot → Loop Habit Tracker', () => {
	test('parses a TimeJot SQLite export', async () => {
		const parsed = await parseTimeJotBackup(fileFrom(timeJotBytes, 'timejot.db'), SQL);
		expect([...parsed.events.values()].map(event => event.title)).toEqual([
			'event horizon', 'no cigarettes', 'no sleep token'
		]);
		expect(parsed.entries).toHaveLength(3);
		expect(parsed.entries.find(entry => entry.eventId === 6)?.dayKey).toBe('2025-06-07');
	});

	test('imports boolean days and skips an existing overlap without overwriting it', async () => {
		const target = new SQL.Database(makeUHabits());
		target.run('INSERT INTO Repetitions (habit, timestamp, value, notes) VALUES (1, ?, 2, ?)', [Date.UTC(2025, 5, 7), 'keep me']);
		const targetBytes = target.export();
		target.close();

		const result = await convertTimeJotToUHabits(
			fileFrom(timeJotBytes, 'timejot.db'),
			fileFrom(targetBytes, 'habits.db'),
			[
				{ sourceId: 6, uhabitsHabitId: 1 },
				{ sourceId: 7, uhabitsHabitId: 1 }
			],
			SQL
		);
		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value, notes FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([
			[Date.UTC(2025, 5, 7), 2, 'keep me'],
			[Date.UTC(2025, 6, 27), 2, '']
		]);
		output.close();
	});

	test('encodes custom numeric values in thousandths and sums mappings on the same day', async () => {
		const result = await convertTimeJotToUHabits(
			fileFrom(timeJotBytes, 'timejot.db'),
			fileFrom(makeUHabits(), 'habits.db'),
			[
				{ sourceId: 6, uhabitsHabitId: 2, numericValue: 2 },
				{ sourceId: 6, uhabitsHabitId: 2, numericValue: 1 }
			],
			SQL
		);
		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 2')[0].values;
		expect(rows).toEqual([[Date.UTC(2025, 5, 7), 3000]]);
		output.close();
	});

	test('inverts TimeJot days for boolean habits within the recorded range', async () => {
		const result = await convertTimeJotToUHabits(
			fileFrom(timeJotGapBytes, 'timejot.db'),
			fileFrom(makeUHabits(), 'habits.db'),
			[{ sourceId: 1, uhabitsHabitId: 1, invertTimeJot: true }],
			SQL
		);
		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([[Date.UTC(2025, 7, 2), 2]]);
		output.close();
	});

	test('limits inversion to the largest uHabits tracking gap containing the event', async () => {
		const existingDays = [
			Date.UTC(2025, 5, 1),
			Date.UTC(2025, 5, 3),
			Date.UTC(2025, 6, 31),
			Date.UTC(2025, 7, 4)
		];
		const result = await convertTimeJotToUHabits(
			fileFrom(timeJotTrackingGapBytes, 'timejot.db'),
			fileFrom(makeUHabits(existingDays), 'habits.db'),
			[{ sourceId: 1, uhabitsHabitId: 1, invertTimeJot: true }],
			SQL
		);
		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([
			[Date.UTC(2025, 5, 1), 2],
			[Date.UTC(2025, 5, 3), 2],
			[Date.UTC(2025, 6, 31), 2],
			[Date.UTC(2025, 7, 2), 2],
			[Date.UTC(2025, 7, 4), 2]
		]);
		output.close();
	});

	test('applies the after-midnight buffer without inversion', async () => {
		const result = await convertTimeJotToUHabits(
			fileFrom(timeJotGapBytes, 'timejot.db'),
			fileFrom(makeUHabits(), 'habits.db'),
			[{ sourceId: 1, uhabitsHabitId: 1, timeJotRolloverHours: 3 }],
			SQL
		);
		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([
			[Date.UTC(2025, 6, 31), 2],
			[Date.UTC(2025, 7, 3), 2]
		]);
		output.close();
	});

	test('applies the after-midnight buffer before inversion', async () => {
		const result = await convertTimeJotToUHabits(
			fileFrom(timeJotGapBytes, 'timejot.db'),
			fileFrom(makeUHabits(), 'habits.db'),
			[{ sourceId: 1, uhabitsHabitId: 1, invertTimeJot: true, timeJotRolloverHours: 3 }],
			SQL
		);
		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([
			[Date.UTC(2025, 7, 1), 2],
			[Date.UTC(2025, 7, 2), 2]
		]);
		output.close();
	});

	test('ignores inversion for numeric habits', async () => {
		const result = await convertTimeJotToUHabits(
			fileFrom(timeJotGapBytes, 'timejot.db'),
			fileFrom(makeUHabits(), 'habits.db'),
			[{ sourceId: 1, uhabitsHabitId: 2, numericValue: 2, invertTimeJot: true, timeJotRolloverHours: 3 }],
			SQL
		);
		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 2 ORDER BY timestamp')[0].values;
		expect(rows).toEqual([
			[Date.UTC(2025, 6, 31), 2000],
			[Date.UTC(2025, 7, 3), 2000]
		]);
		output.close();
	});
});

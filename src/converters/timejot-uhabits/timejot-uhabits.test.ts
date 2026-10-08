import { beforeEach, describe, expect, test } from 'vitest';
import { addHabit, createHabitTables, createTimeJotTables, sqliteFile, useSqlite } from '@tests/helpers/sqlite';
import { parseTimeJotBackup } from './timejotParser';
import { convertTimeJotToUHabits } from './toUHabits';

const sqlite = useSqlite();
let targetFile: File;

beforeEach(() => {
	const db = sqlite.open();
	createHabitTables(db);
	addHabit(db, 1, 'Boolean target', 0);
	addHabit(db, 2, 'Points target', 1, 'points');
	targetFile = sqliteFile(db.export());
});

function makeTimeJot(): Uint8Array {
	const db = sqlite.open();
	createTimeJotTables(db);
	db.run("INSERT INTO events VALUES (2, 'event horizon', 0), (6, 'no sleep token', 0), (7, 'no cigarettes', 0)");
	db.run(`INSERT INTO entries VALUES
		(1, 'existing overlap', 6, '2025-06-07T10:05:00+02:00', 0),
		(2, NULL, 7, '2025-07-27T03:00:00+02:00', 0),
		(3, NULL, 2, '2025-08-01T20:54:00+02:00', 0),
		(4, 'still running', 2, '2025-08-02T20:54:00+02:00', 1)`);
	const bytes = db.export();
	return bytes;
}

function makeTimeJotWithGap(firstDate = '2025-08-01T02:00:00+02:00'): Uint8Array {
	const db = sqlite.open();
	createTimeJotTables(db);
	db.run("INSERT INTO events VALUES (1, 'negative habit', 0)");
	db.run(`INSERT INTO entries VALUES
		(1, NULL, 1, '${firstDate}', 0),
		(2, NULL, 1, '2025-08-03T10:00:00+02:00', 0)`);
	const bytes = db.export();
	return bytes;
}

describe('TimeJot → Loop Habit Tracker', () => {
	test('excludes ongoing entries when a TimeJot export is parsed', async () => {
		const sourceFile = sqliteFile(makeTimeJot(), 'timejot.db');

		const parsed = await parseTimeJotBackup(sourceFile, sqlite.SQL);

		expect([...parsed.events.values()].map(event => event.title)).toEqual([
			'event horizon', 'no cigarettes', 'no sleep token'
		]);
		expect(parsed.entries).toHaveLength(3);
		expect(parsed.entries.find(entry => entry.eventId === 6)?.dayKey).toBe('2025-06-07');
	});

	test('preserves existing days when imported boolean history overlaps', async () => {
		const target = sqlite.open(new Uint8Array(await targetFile.arrayBuffer()));
		target.run('INSERT INTO Repetitions (habit, timestamp, value, notes) VALUES (1, ?, 2, ?)', [Date.UTC(2025, 5, 7), 'keep me']);
		const targetBytes = target.export();

		const sourceFile = sqliteFile(makeTimeJot(), 'timejot.db');

		const result = await convertTimeJotToUHabits(
			sourceFile,
			sqliteFile(targetBytes, 'habits.db'),
			[
				{ sourceId: 6, uhabitsHabitId: 1 },
				{ sourceId: 7, uhabitsHabitId: 1 }
			],
			sqlite.SQL
		);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value, notes FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 5, 7), 2, 'keep me'],
			[Date.UTC(2025, 6, 27), 2, '']
		]);
	});

	test('sums values in thousandths when numeric mappings share a day', async () => {
		const sourceFile = sqliteFile(makeTimeJot(), 'timejot.db');

		const result = await convertTimeJotToUHabits(
			sourceFile,
			targetFile,
			[
				{ sourceId: 6, uhabitsHabitId: 2, numericValue: 2 },
				{ sourceId: 6, uhabitsHabitId: 2, numericValue: 1 }
			],
			sqlite.SQL
		);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 2')[0].values;

		expect(rows).toEqual([[Date.UTC(2025, 5, 7), 3000]]);
	});

	test('imports unrecorded days when a boolean event is inverted', async () => {
		const sourceFile = sqliteFile(makeTimeJotWithGap(), 'timejot.db');

		const result = await convertTimeJotToUHabits(
			sourceFile,
			targetFile,
			[{ sourceId: 1, uhabitsHabitId: 1, invertTimeJot: true }],
			sqlite.SQL
		);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([[Date.UTC(2025, 7, 2), 2]]);
	});

	test('limits inversion to the largest matching gap when the target has history', async () => {
		const existingDays = [
			Date.UTC(2025, 5, 1),
			Date.UTC(2025, 5, 3),
			Date.UTC(2025, 6, 31),
			Date.UTC(2025, 7, 4)
		];
		const target = sqlite.open(new Uint8Array(await targetFile.arrayBuffer()));
		for (const timestamp of existingDays) {
			target.run('INSERT INTO Repetitions (habit, timestamp, value, notes) VALUES (1, ?, 2, ?)', [timestamp, 'existing']);
		}
		targetFile = sqliteFile(target.export());

		const sourceFile = sqliteFile(makeTimeJotWithGap('2025-08-01T10:00:00+02:00'), 'timejot.db');

		const result = await convertTimeJotToUHabits(
			sourceFile,
			targetFile,
			[{ sourceId: 1, uhabitsHabitId: 1, invertTimeJot: true }],
			sqlite.SQL
		);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 5, 1), 2],
			[Date.UTC(2025, 5, 3), 2],
			[Date.UTC(2025, 6, 31), 2],
			[Date.UTC(2025, 7, 2), 2],
			[Date.UTC(2025, 7, 4), 2]
		]);
	});

	test('counts early entries toward the previous day when rollover is enabled', async () => {
		const sourceFile = sqliteFile(makeTimeJotWithGap(), 'timejot.db');

		const result = await convertTimeJotToUHabits(
			sourceFile,
			targetFile,
			[{ sourceId: 1, uhabitsHabitId: 1, timeJotRolloverHours: 3 }],
			sqlite.SQL
		);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 6, 31), 2],
			[Date.UTC(2025, 7, 3), 2]
		]);
	});

	test('shifts the inversion range when rollover is enabled', async () => {
		const sourceFile = sqliteFile(makeTimeJotWithGap(), 'timejot.db');

		const result = await convertTimeJotToUHabits(
			sourceFile,
			targetFile,
			[{ sourceId: 1, uhabitsHabitId: 1, invertTimeJot: true, timeJotRolloverHours: 3 }],
			sqlite.SQL
		);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 7, 1), 2],
			[Date.UTC(2025, 7, 2), 2]
		]);
	});

	test('imports recorded days when inversion is requested for a numeric habit', async () => {
		const sourceFile = sqliteFile(makeTimeJotWithGap(), 'timejot.db');

		const result = await convertTimeJotToUHabits(
			sourceFile,
			targetFile,
			[{ sourceId: 1, uhabitsHabitId: 2, numericValue: 2, invertTimeJot: true, timeJotRolloverHours: 3 }],
			sqlite.SQL
		);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 2 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 6, 31), 2000],
			[Date.UTC(2025, 7, 3), 2000]
		]);
	});

	test('skips invalid dates when a TimeJot export also contains valid entries', async () => {
		const source = sqlite.open(makeTimeJot());
		source.run("INSERT INTO entries VALUES (5, 'broken date', 6, 'not-a-date', 0)");
		const sourceFile = sqliteFile(source.export(), 'mixed.db');

		const parsed = await parseTimeJotBackup(sourceFile, sqlite.SQL);

		expect(parsed.entries.map(entry => entry.id)).toEqual([1, 2, 3]);
		expect(parsed.entries.some(entry => entry.note === 'still running')).toBe(false);
		expect(parsed.entries.some(entry => entry.note === 'broken date')).toBe(false);
	});

	test('copies notes once when repeated TimeJot mappings share a boolean day', async () => {
		const sourceFile = sqliteFile(makeTimeJot(), 'timejot.db');
		const mapping = { sourceId: 6, uhabitsHabitId: 1, copySourceNotes: true };

		const result = await convertTimeJotToUHabits(sourceFile, targetFile, [mapping, { ...mapping }], sqlite.SQL);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT habit, timestamp, value, notes FROM Repetitions')[0].values;

		expect(rows).toEqual([[1, Date.UTC(2025, 5, 7), 2, 'existing overlap']]);
	});

	test.each([
		['the source event is missing', { sourceId: 999, uhabitsHabitId: 1 }],
		['the target habit is missing', { sourceId: 6, uhabitsHabitId: 999 }],
		['the event has no completed entries', { sourceId: 8, uhabitsHabitId: 1, invertTimeJot: true }]
	])('exports unchanged history when %s', async (_condition, mapping) => {
		const source = sqlite.open(makeTimeJot());
		source.run("INSERT INTO events VALUES (8, 'Empty event', 0)");
		const sourceFile = sqliteFile(source.export(), 'timejot.db');

		const result = await convertTimeJotToUHabits(sourceFile, targetFile, [mapping], sqlite.SQL);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const repetitions = output.exec('SELECT COUNT(*) FROM Repetitions')[0].values;
		const habits = output.exec('SELECT id, name FROM Habits ORDER BY id')[0].values;

		expect(repetitions).toEqual([[0]]);
		expect(habits).toEqual([[1, 'Boolean target'], [2, 'Points target']]);
	});

	test.each(['not a SQLite database', 'missing export tables'])('rejects an export when it contains %s', async condition => {
		const file = condition === 'missing export tables'
			? sqliteFile(sqlite.open().export(), 'empty.db')
			: new File(['not a SQLite database'], 'broken.db');
		const expectedError = condition === 'missing export tables' ? /no such table/ : /file is not a database/;

		const parse = () => parseTimeJotBackup(file, sqlite.SQL);

		await expect(parse()).rejects.toThrow(expectedError);
	});
});

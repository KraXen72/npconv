import { beforeEach, describe, expect, test } from 'vitest';
import { addHabit, createHabitTables, sqliteFile, useSqlite } from '@tests/helpers/sqlite';
import type { ConversionMapping } from '../../schemas/uhabits';
import { convertSttToUHabits } from './toUHabits';

const sqlite = useSqlite();
let targetFile: File;

beforeEach(() => {
	const db = sqlite.open();
	createHabitTables(db);
	addHabit(db, 1, 'Boolean target', 0);
	addHabit(db, 2, 'Points target', 1, 'points');
	targetFile = sqliteFile(db.export());
});

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

describe('Simple Time Tracker → Loop Habit Tracker', () => {
	test('preserves existing days and deduplicates notes when filtered records overlap', async () => {
		const target = sqlite.open(new Uint8Array(await targetFile.arrayBuffer()));
		target.run(
			'INSERT INTO Repetitions (habit, timestamp, value, notes) VALUES (1, ?, 2, ?)',
			[Date.UTC(2025, 5, 8), 'existing']
		);
		const targetBytes = target.export();

		const sourceFile = new File([sttBackup()], 'stt.backup');

		const result = await convertSttToUHabits(
			sourceFile,
			sqliteFile(targetBytes, 'habits.db'),
			[{ sourceId: 1, uhabitsHabitId: 1, minDuration: 20, copySourceNotes: true }],
			sqlite.SQL
		);

		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value, notes FROM Repetitions WHERE habit = 1 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 5, 7), 2, 'keep this'],
			[Date.UTC(2025, 5, 8), 2, 'existing']
		]);
	});

	test('sums numeric values when multiple STT mappings target the same habit and day', async () => {
		const sourceFile = new File([sttBackup()], 'stt.backup');

		const result = await convertSttToUHabits(
			sourceFile,
			targetFile,
			[
				{ sourceId: 1, uhabitsHabitId: 2, minDuration: 20, numericValue: 1.25 },
				{ sourceId: 2, uhabitsHabitId: 2, minDuration: 20, numericValue: 2 }
			],
			sqlite.SQL
		);

		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 2 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 5, 7), 1250],
			[Date.UTC(2025, 5, 8), 3250]
		]);
	});

	test('imports boundary durations when records meet the minimum exactly', async () => {
		const minMinutes = 20;
		const minDurationMs = minMinutes * 60_000;
		const firstDay = Date.UTC(2025, 5, 7, 23, 59);
		const secondDay = Date.UTC(2025, 5, 8, 10);
		const thirdDay = Date.UTC(2025, 5, 9, 10);
		const sourceFile = new File([[
			'recordType\t1\tReading\t📖\t0\t0',
			`record\t1\t1\t${firstDay}\t${firstDay + minDurationMs}`,
			`record\t2\t1\t${secondDay}\t${secondDay + minDurationMs - 1}`,
			`record\t3\t1\t${thirdDay}\t${thirdDay + minDurationMs + 1}`
		].join('\n')], 'boundaries.backup');
		const mappings = [{ sourceId: 1, uhabitsHabitId: 1, minDuration: minMinutes }];

		const result = await convertSttToUHabits(sourceFile, targetFile, mappings, sqlite.SQL);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions ORDER BY timestamp')[0].values;

		expect(rows).toEqual([[Date.UTC(2025, 5, 7), 2], [Date.UTC(2025, 5, 9), 2]]);
	});

	test.each([
		['the source is missing', { sourceId: 999, uhabitsHabitId: 1 }],
		['the target is missing', { sourceId: 1, uhabitsHabitId: 999 }],
		['the target type is unsupported', { sourceId: 1, uhabitsHabitId: 3 }],
		['the numeric value is zero', { sourceId: 1, uhabitsHabitId: 2, numericValue: 0 }],
		['the numeric value is negative', { sourceId: 1, uhabitsHabitId: 2, numericValue: -1 }],
		['the numeric value is NaN', { sourceId: 1, uhabitsHabitId: 2, numericValue: NaN }],
		['the numeric value is infinite', { sourceId: 1, uhabitsHabitId: 2, numericValue: Infinity }]
	] satisfies [string, ConversionMapping][])('skips the mapping when %s', async (_condition, invalidMapping) => {
		const target = sqlite.open(new Uint8Array(await targetFile.arrayBuffer()));
		addHabit(target, 3, 'Unsupported', 2);
		const sourceFile = new File([sttBackup()], 'stt.backup');
		const mappings = [invalidMapping, { sourceId: 2, uhabitsHabitId: 1 }];
		const inputFile = sqliteFile(target.export());

		const result = await convertSttToUHabits(sourceFile, inputFile, mappings, sqlite.SQL);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT habit, timestamp, value FROM Repetitions ORDER BY timestamp')[0].values;

		expect(rows).toEqual([[1, Date.UTC(2025, 5, 8), 2]]);
	});

	test('keeps one repetition and combines notes when boolean mappings share a day', async () => {
		const sourceFile = new File([sttBackup()], 'stt.backup');
		const mappings = [
			{ sourceId: 1, uhabitsHabitId: 1, copySourceNotes: true },
			{ sourceId: 2, uhabitsHabitId: 1, copySourceNotes: true }
		];

		const result = await convertSttToUHabits(sourceFile, targetFile, mappings, sqlite.SQL);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value, notes FROM Repetitions ORDER BY timestamp')[0].values;

		expect(rows).toEqual([
			[Date.UTC(2025, 5, 7), 2, 'short; keep this'],
			[Date.UTC(2025, 5, 8), 2, 'second day; run']
		]);
	});

	test('leaves history unchanged when the same import is applied twice', async () => {
		const sourceFile = new File([sttBackup()], 'stt.backup');
		const mappings = [{ sourceId: 1, uhabitsHabitId: 2, numericValue: 1.25, copySourceNotes: true }];
		const firstResult = await convertSttToUHabits(sourceFile, targetFile, mappings, sqlite.SQL);
		const firstBytes = new Uint8Array(await firstResult.arrayBuffer());
		const initial = sqlite.open(firstBytes).exec('SELECT habit, timestamp, value, notes FROM Repetitions ORDER BY timestamp')[0].values;

		const secondResult = await convertSttToUHabits(sourceFile, sqliteFile(firstBytes), mappings, sqlite.SQL);
		const repeated = sqlite.open(new Uint8Array(await secondResult.arrayBuffer())).exec('SELECT habit, timestamp, value, notes FROM Repetitions ORDER BY timestamp')[0].values;

		expect(repeated).toEqual(initial);
		expect(repeated).toEqual([
			[2, Date.UTC(2025, 5, 7), 1250, 'short; keep this'],
			[2, Date.UTC(2025, 5, 8), 1250, 'second day']
		]);
	});

	test('rejects the conversion when the target database is corrupt', async () => {
		const sourceFile = new File([sttBackup()], 'stt.backup');
		const corruptTarget = new File(['not a database'], 'broken.db');

		const convert = () => convertSttToUHabits(sourceFile, corruptTarget, [], sqlite.SQL);

		await expect(convert()).rejects.toThrow(/file is not a database/);
	});
});

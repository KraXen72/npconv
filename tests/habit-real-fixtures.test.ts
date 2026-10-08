import { fixtureFile } from '@tests/helpers/fixtures';
import { describe, expect, test } from 'vitest';
import { useSqlite } from '@tests/helpers/sqlite';
import { parseSttBackup } from '../src/converters/stt-uhabits/sttParser';
import { convertSttToUHabits } from '../src/converters/stt-uhabits/toUHabits';
import { parseUHabitsBackup } from '../src/converters/stt-uhabits/uhabitsHelper';
import { parseTimeJotBackup } from '../src/converters/timejot-uhabits/timejotParser';
import { convertTimeJotToUHabits } from '../src/converters/timejot-uhabits/toUHabits';

const sqlite = useSqlite();
describe('real anonymized habit-backfill fixtures', () => {
	test('ignores legacy tag columns when a real STT backup is parsed', async () => {
		const file = await fixtureFile('habit-backfill/fixture-stt-anonymized.backup');

		const parsed = await parseSttBackup(file);

		expect(parsed.recordTypes.size).toBe(19);
		expect(parsed.records).toHaveLength(2578);
		expect(parsed.categories.size).toBe(4);
		expect(parsed.recordTags.size).toBe(37);
		expect(parsed.records.filter(record => record.comment !== undefined)).toHaveLength(1142);
		expect(parsed.records.find(record => record.id === 6)?.comment).toBeUndefined();
	});

	test('normalizes nullable reminders when a real Loop backup is parsed', async () => {
		const file = await fixtureFile('habit-backfill/fixture-uhabits-anonymized.db');

		const parsed = await parseUHabitsBackup(file, sqlite.SQL);

		expect(parsed.allHabits.size).toBe(31);
		expect(parsed.booleanHabits.size).toBe(24);
		expect(parsed.numericHabits.size).toBe(7);
		expect(parsed.repetitions).toHaveLength(8094);
		expect(parsed.allHabits.get(2)?.reminder_hour).toBe(0);
		expect(parsed.allHabits.get(2)?.reminder_min).toBe(0);
	});

	test('loads completed entries when a real TimeJot export is parsed', async () => {
		const file = await fixtureFile('habit-backfill/fixture-timejot-anonymized.db');

		const parsed = await parseTimeJotBackup(file, sqlite.SQL);

		expect(parsed.events.size).toBe(3);
		expect(parsed.entries).toHaveLength(204);
		expect(parsed.entries.filter(entry => entry.eventId === 2)).toHaveLength(202);
		expect(parsed.entries.filter(entry => entry.eventId === 6)).toHaveLength(1);
		expect(parsed.entries.filter(entry => entry.eventId === 7)).toHaveLength(1);
	});

	test('preserves overlaps when real STT history is imported into a numeric habit', async () => {
		const source = await fixtureFile('habit-backfill/fixture-stt-anonymized.backup');
		const target = await fixtureFile('habit-backfill/fixture-uhabits-anonymized.db');
		const targetBytes = new Uint8Array(await target.arrayBuffer());
		const query = 'SELECT habit, timestamp, value, notes FROM Repetitions ORDER BY habit, timestamp';
		const originalRows = sqlite.open(targetBytes).exec(query)[0].values;
		const originalKeys = new Set(originalRows.map(row => `${row[0]}:${row[1]}`));
		const mappings = [{ sourceId: 1, uhabitsHabitId: 9, minDuration: 20, numericValue: 1.25, copySourceNotes: true }];
		const expectedNewDays = [Date.UTC(2024, 4, 2), Date.UTC(2024, 4, 13), Date.UTC(2024, 5, 20), Date.UTC(2024, 8, 10)];

		const result = await convertSttToUHabits(source, target, mappings, sqlite.SQL);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const outputRows = output.exec(query)[0].values;
		const habitRows = outputRows.filter(row => row[0] === 9);
		const newRows = habitRows.filter(row => Number(row[1]) > Date.UTC(2024, 3, 28));
		const preservedRows = outputRows.filter(row => originalKeys.has(`${row[0]}:${row[1]}`));

		expect(preservedRows).toEqual(originalRows);
		expect(habitRows).toHaveLength(487);
		expect(newRows.filter(row => Number(row[2]) === 1250).map(row => Number(row[1]))).toEqual(expectedNewDays);
		for (const timestamp of [Date.UTC(2024, 3, 12), Date.UTC(2024, 3, 22)]) {
			const matching = habitRows.filter(row => Number(row[1]) === timestamp);
			expect(matching).toHaveLength(1);
			expect(Number(matching[0][2])).toBe(1250);
		}
	});

	test('adds the source day when a real TimeJot event is imported', async () => {
		const source = await fixtureFile('habit-backfill/fixture-timejot-anonymized.db');
		const target = await fixtureFile('habit-backfill/fixture-uhabits-anonymized.db');
		const mappings = [{ sourceId: 6, uhabitsHabitId: 35 }];

		const result = await convertTimeJotToUHabits(source, target, mappings, sqlite.SQL);
		const output = sqlite.open(new Uint8Array(await result.arrayBuffer()));
		const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 35 ORDER BY timestamp')[0].values;

		expect(rows).toEqual([[Date.UTC(2025, 5, 7), 2], [Date.UTC(2026, 7, 28), 2]]);
	});
});

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { parseSttBackup } from '../src/converters/stt-uhabits/sttParser';
import { convertSttToUHabits } from '../src/converters/stt-uhabits/toUHabits';
import { parseUHabitsBackup } from '../src/converters/stt-uhabits/uhabitsHelper';
import { parseTimeJotBackup } from '../src/converters/timejot-uhabits/timejotParser';
import { convertTimeJotToUHabits } from '../src/converters/timejot-uhabits/toUHabits';

let SQL: SqlJsStatic;

const fixtureUrl = (name: string) => new URL(`../fixtures/habit-backfill/${name}.gz.b64`, import.meta.url);

const fileFromBytes = (bytes: Uint8Array, name: string) => ({
	name,
	arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}) as File;

const fileFromText = (text: string, name: string) => ({
	name,
	text: async () => text
}) as File;

const loadBytes = async (name: string) => {
	const encoded = await readFile(fixtureUrl(name), 'utf8');
	return new Uint8Array(gunzipSync(Buffer.from(encoded.trim(), 'base64')));
};
const loadText = async (name: string) => new TextDecoder().decode(await loadBytes(name));

beforeAll(async () => {
	SQL = await initSqlJs();
});

describe('real anonymized habit-backfill fixtures', () => {
	test('parses a real Simple Time Tracker backup without treating the legacy tag column as a comment', async () => {
		const parsed = await parseSttBackup(fileFromText(
			await loadText('fixture-stt-anonymized.backup'),
			'fixture-stt-anonymized.backup'
		));

		expect(parsed.recordTypes.size).toBe(19);
		expect(parsed.records).toHaveLength(2578);
		expect(parsed.categories.size).toBe(4);
		expect(parsed.recordTags.size).toBe(37);
		expect(parsed.records.filter(record => record.comment !== undefined)).toHaveLength(1142);
		expect(parsed.records.find(record => record.id === 6)?.comment).toBeUndefined();
	});

	test('parses a real Loop Habit Tracker backup including nullable reminders', async () => {
		const parsed = await parseUHabitsBackup(
			fileFromBytes(await loadBytes('fixture-uhabits-anonymized.db'), 'fixture-uhabits-anonymized.db'),
			SQL
		);

		try {
			expect(parsed.allHabits.size).toBe(31);
			expect(parsed.booleanHabits.size).toBe(24);
			expect(parsed.numericHabits.size).toBe(7);
			expect(parsed.repetitions).toHaveLength(8094);
			expect(parsed.allHabits.get(2)?.reminder_hour).toBe(0);
			expect(parsed.allHabits.get(2)?.reminder_min).toBe(0);
		} finally {
			parsed.db.close();
		}
	});

	test('parses a real TimeJot export', async () => {
		const parsed = await parseTimeJotBackup(
			fileFromBytes(await loadBytes('fixture-timejot-anonymized.db'), 'fixture-timejot-anonymized.db'),
			SQL
		);

		expect(parsed.events.size).toBe(3);
		expect(parsed.entries).toHaveLength(204);
		expect(parsed.entries.filter(entry => entry.eventId === 2)).toHaveLength(202);
		expect(parsed.entries.filter(entry => entry.eventId === 6)).toHaveLength(1);
		expect(parsed.entries.filter(entry => entry.eventId === 7)).toHaveLength(1);
	});

	test('converts real STT history into a real numeric Loop habit without overwriting overlaps', async () => {
		const result = await convertSttToUHabits(
			fileFromText(await loadText('fixture-stt-anonymized.backup'), 'fixture-stt-anonymized.backup'),
			fileFromBytes(await loadBytes('fixture-uhabits-anonymized.db'), 'fixture-uhabits-anonymized.db'),
			[{ sourceId: 1, uhabitsHabitId: 9, minDuration: 20, numericValue: 1.25, copySourceNotes: true }],
			SQL
		);

		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		try {
			const rows = output.exec('SELECT timestamp, value, notes FROM Repetitions WHERE habit = 9 ORDER BY timestamp')[0].values;
			expect(rows).toHaveLength(487);

			const newRows = rows.filter(row => Number(row[0]) > Date.UTC(2024, 3, 28));
			const expectedNewRows = [
				Date.UTC(2024, 4, 2),
				Date.UTC(2024, 4, 13),
				Date.UTC(2024, 5, 20),
				Date.UTC(2024, 8, 10)
			];
			// Two additional imported days (April 12 and April 22) fall before the
			// final pre-existing repetition and are checked separately below.
			expect(newRows.filter(row => Number(row[1]) === 1250).map(row => Number(row[0]))).toEqual(expectedNewRows);

			for (const timestamp of [Date.UTC(2024, 3, 12), Date.UTC(2024, 3, 22)]) {
				const matching = rows.filter(row => Number(row[0]) === timestamp);
				expect(matching).toHaveLength(1);
				expect(Number(matching[0][1])).toBe(1250);
			}
		} finally {
			output.close();
		}
	});

	test('converts a real TimeJot event into a real Loop backup', async () => {
		const result = await convertTimeJotToUHabits(
			fileFromBytes(await loadBytes('fixture-timejot-anonymized.db'), 'fixture-timejot-anonymized.db'),
			fileFromBytes(await loadBytes('fixture-uhabits-anonymized.db'), 'fixture-uhabits-anonymized.db'),
			[{ sourceId: 6, uhabitsHabitId: 35 }],
			SQL
		);

		const output = new SQL.Database(new Uint8Array(await result.arrayBuffer()));
		try {
			const rows = output.exec('SELECT timestamp, value FROM Repetitions WHERE habit = 35 ORDER BY timestamp')[0].values;
			expect(rows).toEqual([
				[Date.UTC(2025, 5, 7), 2],
				[Date.UTC(2026, 7, 28), 2]
			]);
		} finally {
			output.close();
		}
	});
});
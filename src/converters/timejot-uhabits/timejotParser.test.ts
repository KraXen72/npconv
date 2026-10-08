import { describe, expect, test } from 'vitest';
import { invertTimeJotDays, timeJotDayKey } from './timejotParser';

describe('TimeJot calendar days', () => {
	test.each([
		['2025-01-01T02:59:00+14:00', 3, '2024-12-31'],
		['2025-01-01T03:00:00-12:00', 3, '2025-01-01'],
		['2025-03-01T00:00:00+02:00', 1, '2025-02-28'],
		['2024-03-01T00:00:00+02:00', 1, '2024-02-29'],
		['2025-06-07T02:00:00+02:00', -1, '2025-06-07'],
		['2025-06-07T23:59:00+02:00', 25, '2025-06-06'],
		['2025-06-07T03:00:00+02:00', 3.9, '2025-06-07'],
		['2025-06-07T00:00:00+02:00', NaN, '2025-06-07'],
		['2025-06-07T00:00:00+02:00', Infinity, '2025-06-07'],
		['2025-06-07', 3, '2025-06-07']
	])('returns %s with rollover %s → %s when local timestamp rules apply', (date, rolloverHours, expectedDay) => {
		const inputDate = date;

		const day = timeJotDayKey(inputDate, rolloverHours);

		expect(day).toBe(expectedDay);
	});

	test('keeps the local calendar date when rollover is omitted', () => {
		const date = '2025-06-07T00:30:00+14:00';

		const day = timeJotDayKey(date);

		expect(day).toBe('2025-06-07');
	});
});

describe('TimeJot inversion', () => {
	test.each([
		{ condition: 'no source days exist', recorded: [], existing: [], expected: [] },
		{ condition: 'only one source day exists', recorded: ['2025-06-07'], existing: [], expected: [] },
		{ condition: 'source days repeat out of order', recorded: ['2025-06-09', '2025-06-07', '2025-06-07'], existing: [], expected: ['2025-06-08'] },
		{ condition: 'target days are adjacent', recorded: ['2025-06-07'], existing: ['2025-06-07', '2025-06-08'], expected: [] },
		{ condition: 'no target gap contains a source day', recorded: ['2025-06-01'], existing: ['2025-06-07', '2025-06-10'], expected: [] },
		{ condition: 'one target day cannot bound a gap', recorded: ['2025-06-07', '2025-06-09'], existing: ['2025-06-01'], expected: ['2025-06-08'] },
		{ condition: 'the largest matching gap appears last', recorded: ['2025-06-02', '2025-06-06'], existing: ['2025-06-10', '2025-06-04', '2025-06-01', '2025-06-01'], expected: ['2025-06-05', '2025-06-07', '2025-06-08', '2025-06-09'] }
	])('returns only unrecorded days when $condition', ({ recorded, existing, expected }) => {
		const sourceDays = new Set(recorded);

		const inverted = invertTimeJotDays(sourceDays, existing);

		expect([...inverted]).toEqual(expected);
		expect([...sourceDays]).toEqual([...new Set(recorded)]);
	});
});

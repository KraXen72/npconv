import { describe, expect, test } from 'vitest';
import { logStore } from '../../logger';
import { parseSttBackup } from './sttParser';

describe('STT backup parser', () => {
	test('keeps valid rows when malformed rows and unknown metadata are present', async () => {
		const start = Date.UTC(2025, 5, 7, 10);
		const file = new File([[
			'recordType\t1\tReading\t📖\t0\t0',
			'recordType\tbad-id\tBroken',
			`record\t1\t1\t${start}\t${start + 60_000}\tChapter one\t99`,
			`record\t2\t1\tinvalid\t${start}`,
			'category\tbad-id\tBroken',
			'category\t1\tHobbies\t3',
			'recordTag\tbad-id\t\tBroken',
			'recordTag\t1\t\tBook\t2\t1\t\t📚',
			'prefs\tignored',
			''
		].join('\n')], 'mixed.backup');

		const parsed = await parseSttBackup(file);

		expect([...parsed.recordTypes.values()]).toEqual([{ id: 1, name: 'Reading', emoji: '📖', color: 0, category_id: 0 }]);
		expect(parsed.records).toEqual([{ id: 1, type_id: 1, start_timestamp: start, end_timestamp: start + 60_000, comment: 'Chapter one' }]);
		expect([...parsed.categories.values()]).toEqual([{ id: 1, name: 'Hobbies', color: 3 }]);
		expect([...parsed.recordTags.values()]).toEqual([{ id: 1, name: 'Book', emoji: '📚', color: 2, type_id: 1 }]);
		expect(logStore.logs()).toContain('Skipping invalid STT record row');
	});

	test('returns empty collections when a backup has no activity data', async () => {
		const file = new File(['\n\nprefs\tignored\n'], 'empty.backup');

		const parsed = await parseSttBackup(file);

		expect(parsed.recordTypes.size).toBe(0);
		expect(parsed.records).toEqual([]);
		expect(parsed.categories.size).toBe(0);
		expect(parsed.recordTags.size).toBe(0);
	});
});

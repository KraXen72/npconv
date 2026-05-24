import { describe, expect, test } from 'vitest';
import initSqlJs from 'sql.js';
import * as v from 'valibot';
import { selectRows, validatePayload } from '../db/sqljs';
import { LibreTubeBackupSchema } from './libretube';
import { NewPipeStateRowSchema, NewPipeStreamInsertSchema } from './newpipe';
import { UHabitsRepetitionInsertSchema } from './uhabits';

describe('shared schemas', () => {
	test('invalidLibreTubeBackup_reportsValidationFailure', () => {
		const result = v.safeParse(LibreTubeBackupSchema, {
			watchHistory: 'not-an-array',
			subscriptions: []
		});

		expect(result.success).toBe(false);
	});

	test('invalidSqlRowShape_failsAtSelectBoundary', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();

		try {
			db.run('CREATE TABLE state_rows (url TEXT NOT NULL, progress_time TEXT NOT NULL)');
			db.run('INSERT INTO state_rows (url, progress_time) VALUES (?, ?)', ['https://www.youtube.com/watch?v=abc', 'not-a-number']);

			expect(() => selectRows(db, 'SELECT url, progress_time FROM state_rows', NewPipeStateRowSchema)).toThrow(/failed validation/);
		} finally {
			db.close();
		}
	});

	test('invalidNewPipeStreamPayload_failsBeforeWrite', () => {
		expect(() => validatePayload(NewPipeStreamInsertSchema, {
			service_id: 0,
			url: 'https://www.youtube.com/watch?v=abc',
			title: 'Example',
			stream_type: 'AUDIO_STREAM',
			duration: 10,
			uploader: 'Uploader',
			upload_date: null,
			thumbnail_url: null
		}, 'NewPipe stream insert')).toThrow(/failed validation/);
	});

	test('invalidUHabitsRepetitionPayload_failsBeforeWrite', () => {
		expect(() => validatePayload(UHabitsRepetitionInsertSchema, {
			habitId: 1,
			timestamp: 1.5,
			value: 2,
			notes: ''
		}, 'uHabits repetition insert')).toThrow(/failed validation/);
	});
});

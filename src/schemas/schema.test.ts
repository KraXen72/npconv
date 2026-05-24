import { describe, expect, test } from 'vitest';
import initSqlJs from 'sql.js';
import * as v from 'valibot';
import { selectRows, validatePayload } from '../db/sqljs';
import { LibreTubeBackupSchema } from './libretube';
import { createSchema } from '../sqlHelper';
import { getNewPipeDb, subscriptions } from '../db/newpipeTables';
import { getUHabitsDb, habits, repetitions } from '../db/uhabitsTables';
import { NewPipeStateRowSchema, NewPipeStreamInsertSchema, NewPipeSubscriptionDbSchema } from './newpipe';
import { UHabitsHabitDbSchema, UHabitsRepetitionDbSchema, UHabitsRepetitionInsertSchema } from './uhabits';

describe('shared schemas', () => {
	test('drizzleSqlJs_wrapsExistingNewPipeDatabase', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();

		try {
			createSchema(db);
			const orm = getNewPipeDb(db);

			orm.insert(subscriptions).values({
				service_id: 0,
				url: 'https://www.youtube.com/channel/example',
				name: 'Example',
				avatar_url: null,
				subscriber_count: 0,
				description: '',
				notification_mode: 0
			}).run();

			const row = orm.select().from(subscriptions).get();

			expect(row?.name).toBe('Example');
			expect(db.export().length).toBeGreaterThan(0);
		} finally {
			db.close();
		}
	});

	test('generatedValibotSchemas_acceptDrizzleSelectedRows', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();

		try {
			createSchema(db);
			const newPipeOrm = getNewPipeDb(db);
			newPipeOrm.insert(subscriptions).values({
				service_id: 0,
				url: 'https://www.youtube.com/channel/example',
				name: 'Example',
				avatar_url: null,
				subscriber_count: 0,
				description: '',
				notification_mode: 0
			}).run();

			const subscription = newPipeOrm.select().from(subscriptions).get();
			expect(v.safeParse(NewPipeSubscriptionDbSchema, subscription).success).toBe(true);

			db.run(`
				CREATE TABLE Habits (
					id INTEGER PRIMARY KEY NOT NULL,
					archived INTEGER NOT NULL,
					color INTEGER NOT NULL,
					description TEXT,
					freq_den INTEGER NOT NULL,
					freq_num INTEGER NOT NULL,
					highlight INTEGER NOT NULL,
					name TEXT NOT NULL,
					position INTEGER NOT NULL,
					reminder_hour INTEGER NOT NULL,
					reminder_min INTEGER NOT NULL,
					reminder_days INTEGER NOT NULL,
					type INTEGER NOT NULL,
					target_type INTEGER NOT NULL,
					target_value REAL NOT NULL,
					unit TEXT NOT NULL,
					question TEXT NOT NULL,
					uuid TEXT
				)
			`);
			db.run(`
				CREATE TABLE Repetitions (
					id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
					habit INTEGER NOT NULL,
					timestamp INTEGER NOT NULL,
					value INTEGER NOT NULL,
					notes TEXT
				)
			`);

			const uhabitsOrm = getUHabitsDb(db);
			uhabitsOrm.insert(habits).values({
				id: 1,
				archived: 0,
				color: 1,
				description: null,
				freqDen: 1,
				freqNum: 1,
				highlight: 0,
				name: 'Read',
				position: 0,
				reminderHour: 8,
				reminderMin: 0,
				reminderDays: 0,
				type: 0,
				targetType: 0,
				targetValue: 1,
				unit: '',
				question: 'Read?',
				uuid: null
			}).run();
			uhabitsOrm.insert(repetitions).values({
				habitId: 1,
				timestamp: 1716508800000,
				value: 2,
				notes: null
			}).run();

			expect(v.safeParse(UHabitsHabitDbSchema, uhabitsOrm.select().from(habits).get()).success).toBe(true);
			expect(v.safeParse(UHabitsRepetitionDbSchema, uhabitsOrm.select().from(repetitions).get()).success).toBe(true);
		} finally {
			db.close();
		}
	});

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

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

	test('feed_group_schema_matchesRoomExpectations', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();

		try {
			createSchema(db);
			const tableInfo = db.exec('PRAGMA table_info("feed_group")')[0].values;
			const indexList = db.exec('PRAGMA index_list("feed_group")')[0].values;
			const indexInfo = db.exec('PRAGMA index_info("index_feed_group_sort_order")')[0].values;

			expect(tableInfo).toEqual([
				[0, 'uid', 'INTEGER', 1, null, 1],
				[1, 'name', 'TEXT', 1, null, 0],
				[2, 'icon_id', 'INTEGER', 1, null, 0],
				[3, 'sort_order', 'INTEGER', 1, null, 0]
			]);
			expect(indexList.map(row => row[1])).toContain('index_feed_group_sort_order');
			expect(indexInfo.map(row => row[2])).toEqual(['sort_order']);
		} finally {
			db.close();
		}
	});

	test('feed_schema_matchesRoomExpectations', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();

		try {
			createSchema(db);
			const tableInfo = db.exec('PRAGMA table_info("feed")')[0].values;
			const foreignKeys = db.exec('PRAGMA foreign_key_list("feed")')[0].values;
			const indexList = db.exec('PRAGMA index_list("feed")')[0].values;
			const indexInfo = db.exec('PRAGMA index_info("index_feed_subscription_id")')[0].values;

			expect(tableInfo).toEqual([
				[0, 'stream_id', 'INTEGER', 1, null, 1],
				[1, 'subscription_id', 'INTEGER', 1, null, 2]
			]);

			const sortedForeignKeys = [...foreignKeys]
				.map(row => [row[2], row[3], row[4], row[5], row[6], row[7]])
				.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
			expect(sortedForeignKeys).toEqual([
				['streams', 'stream_id', 'uid', 'CASCADE', 'CASCADE', 'NONE'],
				['subscriptions', 'subscription_id', 'uid', 'CASCADE', 'CASCADE', 'NONE']
			]);
			expect(indexList.map(row => row[1])).toContain('index_feed_subscription_id');
			expect(indexInfo.map(row => row[2])).toEqual(['subscription_id']);
		} finally {
			db.close();
		}
	});

	test('playlist_stream_join_schema_matchesRoomExpectations', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();

		try {
			createSchema(db);
			const tableInfo = db.exec('PRAGMA table_info("playlist_stream_join")')[0].values;
			const indexList = db.exec('PRAGMA index_list("playlist_stream_join")')[0].values;
			const streamIndexInfo = db.exec('PRAGMA index_info("index_playlist_stream_join_stream_id")')[0].values;
			const joinIndexInfo = db.exec('PRAGMA index_info("index_playlist_stream_join_playlist_id_join_index")')[0].values;

			expect(tableInfo).toEqual([
				[0, 'playlist_id', 'INTEGER', 1, null, 1],
				[1, 'stream_id', 'INTEGER', 1, null, 0],
				[2, 'join_index', 'INTEGER', 1, null, 2]
			]);
			expect(indexList.map(row => row[1])).toEqual(expect.arrayContaining([
				'index_playlist_stream_join_stream_id',
				'index_playlist_stream_join_playlist_id_join_index'
			]));
			expect(streamIndexInfo.map(row => row[2])).toEqual(['stream_id']);
			expect(joinIndexInfo.map(row => row[2])).toEqual(['playlist_id', 'join_index']);
		} finally {
			db.close();
		}
	});
});

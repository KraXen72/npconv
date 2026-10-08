import { beforeEach, describe, expect, test } from 'vitest';
import type { Database } from 'sql.js';
import * as v from 'valibot';
import { addHabit, addRepetition, createHabitTables, useSqlite } from '@tests/helpers/sqlite';
import { selectOne, selectRows, validatePayload } from '../db/sqljs';
import { LibreTubeBackupSchema } from './libretube';
import { createSchema } from '../sqlHelper';
import { getNewPipeDb, subscriptions } from '../db/newpipeTables';
import { getUHabitsDb, habits, repetitions } from '../db/uhabitsTables';
import { selectHabits } from '../db/uhabitsRepo';
import { NewPipeStateRowSchema, NewPipeStreamInsertSchema, NewPipeSubscriptionDbSchema } from './newpipe';
import { UHabitsHabitDbSchema, UHabitsRepetitionDbSchema, UHabitsRepetitionInsertSchema } from './uhabits';

const sqlite = useSqlite();
let db: Database;
beforeEach(() => {
	db = sqlite.open();
});

describe('shared validation schemas', () => {
	test('accepts subscription rows when Drizzle wraps a NewPipe database', () => {
		createSchema(db);
		const orm = getNewPipeDb(db);
		const subscription = {
			service_id: 0, url: 'https://www.youtube.com/channel/example', name: 'Example',
			avatar_url: null, subscriber_count: 0, description: '', notification_mode: 0
		};
		orm.insert(subscriptions).values(subscription).run();

		const row = orm.select().from(subscriptions).get();
		const validated = v.parse(NewPipeSubscriptionDbSchema, row);
		const reopened = sqlite.open(db.export());
		const persisted = getNewPipeDb(reopened).select().from(subscriptions).get();

		expect(validated).toEqual({ uid: 1, ...subscription });
		expect(persisted).toEqual(validated);
	});

	test('accepts selected rows and normalizes reminders when Loop metadata contains nulls', () => {
		createHabitTables(db);
		addHabit(db, 1, 'Read', 0);
		const dayTimestamp = Date.UTC(2024, 4, 24);
		addRepetition(db, { habitId: 1, timestamp: dayTimestamp, value: 2, notes: null });
		const orm = getUHabitsDb(db);

		const habitRow = v.parse(UHabitsHabitDbSchema, orm.select().from(habits).get());
		const repetitionRow = v.parse(UHabitsRepetitionDbSchema, orm.select().from(repetitions).get());
		const parsedHabit = selectHabits(db)[0];

		expect(habitRow).toMatchObject({ id: 1, name: 'Read', reminderHour: null, reminderMin: null, reminderDays: null });
		expect(repetitionRow).toEqual({ id: 1, habitId: 1, timestamp: dayTimestamp, value: 2, notes: null });
		expect(parsedHabit).toMatchObject({ id: 1, name: 'Read', reminder_hour: 0, reminder_min: 0, reminder_days: 0 });
	});

	test('rejects a backup when watch history is not an array', () => {
		const backup = { watchHistory: 'not-an-array', subscriptions: [] };

		const result = v.safeParse(LibreTubeBackupSchema, backup);

		expect(result.success).toBe(false);
		if (!result.success) expect(v.summarize(result.issues)).toContain('watchHistory');
	});

	test('rejects selected rows when progress is not numeric', () => {
		db.run('CREATE TABLE state_rows (url TEXT NOT NULL, progress_time TEXT NOT NULL)');
		db.run('INSERT INTO state_rows VALUES (?, ?)', ['https://www.youtube.com/watch?v=abc', 'not-a-number']);

		const select = () => selectRows(db, 'SELECT url, progress_time FROM state_rows', NewPipeStateRowSchema);

		expect(select).toThrow(/SQL row.*failed validation.*progress_time/s);
	});

	test('returns no rows when a validated query finds no matches', () => {
		db.run('CREATE TABLE state_rows (url TEXT, progress_time INTEGER)');
		const query = 'SELECT url, progress_time FROM state_rows';

		const rows = selectRows(db, query, NewPipeStateRowSchema);
		const row = selectOne(db, query, NewPipeStateRowSchema);

		expect(rows).toEqual([]);
		expect(row).toBeUndefined();
	});

	test('rejects a stream payload when the stream type is unsupported', () => {
		const stream = {
			service_id: 0, url: 'https://www.youtube.com/watch?v=abc', title: 'Example',
			stream_type: 'AUDIO_STREAM', duration: 10, uploader: 'Uploader', upload_date: null, thumbnail_url: null
		};

		const validate = () => validatePayload(NewPipeStreamInsertSchema, stream, 'NewPipe stream insert');

		expect(validate).toThrow(/NewPipe stream insert failed validation.*stream_type/s);
	});

	test('rejects a repetition payload when the timestamp is fractional', () => {
		const repetition = { habitId: 1, timestamp: 1.5, value: 2, notes: '' };

		const validate = () => validatePayload(UHabitsRepetitionInsertSchema, repetition, 'uHabits repetition insert');

		expect(validate).toThrow(/uHabits repetition insert failed validation.*timestamp/s);
	});
});

describe('NewPipe database compatibility', () => {
	test('creates the required feed group schema when a database is initialized', () => {
		const expectedColumns = [
			[0, 'uid', 'INTEGER', 1, null, 1], [1, 'name', 'TEXT', 1, null, 0],
			[2, 'icon_id', 'INTEGER', 1, null, 0], [3, 'sort_order', 'INTEGER', 1, null, 0]
		];

		createSchema(db);
		const tableInfo = db.exec('PRAGMA table_info("feed_group")')[0].values;
		const indexInfo = db.exec('PRAGMA index_info("index_feed_group_sort_order")')[0].values;

		expect(tableInfo).toEqual(expectedColumns);
		expect(indexInfo.map(row => row[2])).toEqual(['sort_order']);
	});

	test('creates feed relations and indexes when a database is initialized', () => {
		const expectedColumns = [[0, 'stream_id', 'INTEGER', 1, null, 1], [1, 'subscription_id', 'INTEGER', 1, null, 2]];

		createSchema(db);
		const tableInfo = db.exec('PRAGMA table_info("feed")')[0].values;
		const foreignKeys = db.exec('PRAGMA foreign_key_list("feed")')[0].values
			.map(row => [row[2], row[3], row[4], row[5], row[6], row[7]])
			.sort((left, right) => String(left[1]).localeCompare(String(right[1])));
		const indexInfo = db.exec('PRAGMA index_info("index_feed_subscription_id")')[0].values;

		expect(tableInfo).toEqual(expectedColumns);
		expect(foreignKeys).toEqual([
			['streams', 'stream_id', 'uid', 'CASCADE', 'CASCADE', 'NONE'],
			['subscriptions', 'subscription_id', 'uid', 'CASCADE', 'CASCADE', 'NONE']
		]);
		expect(indexInfo.map(row => row[2])).toEqual(['subscription_id']);
	});

	test('creates playlist ordering indexes when a database is initialized', () => {
		const expectedColumns = [
			[0, 'playlist_id', 'INTEGER', 1, null, 1], [1, 'stream_id', 'INTEGER', 1, null, 0],
			[2, 'join_index', 'INTEGER', 1, null, 2]
		];

		createSchema(db);
		const tableInfo = db.exec('PRAGMA table_info("playlist_stream_join")')[0].values;
		const streamIndex = db.exec('PRAGMA index_info("index_playlist_stream_join_stream_id")')[0].values;
		const joinIndex = db.exec('PRAGMA index_info("index_playlist_stream_join_playlist_id_join_index")')[0].values;

		expect(tableInfo).toEqual(expectedColumns);
		expect(streamIndex.map(row => row[2])).toEqual(['stream_id']);
		expect(joinIndex.map(row => row[2])).toEqual(['playlist_id', 'join_index']);
	});
});

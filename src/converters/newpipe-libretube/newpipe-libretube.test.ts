import { fixtureFile, readFixture } from '@tests/helpers/fixtures';
import { beforeEach, describe, expect, test } from 'vitest';
import { useSqlite } from '@tests/helpers/sqlite';
import JSZip from 'jszip';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import * as v from 'valibot';
import { createSchema } from '../../sqlHelper';
import { exportToLibreTube } from './toLibreTube';
import { exportToNewPipe } from './toNewPipe';
import { LibreTubeBackupSchema, type LibreTubeBackup } from '../../schemas/libretube';
import {
	NewPipePlaylistInsertSchema,
	NewPipePlaylistJoinInsertSchema,
	NewPipeRemotePlaylistInsertSchema,
	NewPipeStateRowSchema,
	NewPipeStreamHistoryInsertSchema,
	NewPipeStreamInsertSchema,
	NewPipeStreamStateInsertSchema,
	NewPipeSubscriptionInsertSchema
} from '../../schemas/newpipe';
import { selectRows } from '../../db/sqljs';
import { findPlaylistIdByName, findRemotePlaylistIdByUrlOrName, findStreamIdByServiceUrl } from '../../db/newpipeRepo';
import { SERVICE_ID_YOUTUBE } from '../../constants';
import { extractVideoIdFromUrl } from '../../utils';

const sqlite = useSqlite();
let SQL: SqlJsStatic;
beforeEach(() => {
	SQL = sqlite.SQL;
});
const LIBRETUBE_BACKUP_FIXTURE = 'fixture-libretube-backup-2026-05-24-08_41_14.json';
const NEWPIPE_MERGE_BACKUP_FIXTURE = 'fixture-NewPipeData-20251216_181353.zip';

// i64 max exceeds Number.MAX_SAFE_INTEGER, so keep the sentinel exact as text.
const WATCHED_SENTINEL = '9223372036854775807';
const MAX_SAFE_WATCH_POSITION = Number.MAX_SAFE_INTEGER;

interface StreamProgress {
	duration: number;
	progressTime: number;
}

interface NewPipeConversion {
	db: Database;
	zip: JSZip;
}

function jsonFile(name: string, data: unknown): File {
	return new File([JSON.stringify(data)], name, { type: 'application/json' });
}

async function loadNewPipeConversionFromZip(SQL: SqlJsStatic, zipBytes: Uint8Array): Promise<NewPipeConversion> {
	const zip = await JSZip.loadAsync(zipBytes);
	const dbFile = zip.file('newpipe.db');
	expect(dbFile, 'generated NewPipe backup should contain newpipe.db').not.toBeNull();

	const dbBytes = await dbFile!.async('uint8array');
	return {
		db: new SQL.Database(dbBytes),
		zip
	};
}

function firstRow(db: Database, sql: string, params: SqlValue[] = []): SqlValue[] {
	const result = db.exec(sql, params);
	expect(result, `expected query to return a row: ${sql}`).toHaveLength(1);
	expect(result[0].values, `expected query to return a row: ${sql}`).not.toHaveLength(0);
	return result[0].values[0];
}

function streamProgressByTitle(db: Database, title: string): StreamProgress {
	const row = firstRow(
		db,
		`
			SELECT s.duration, ss.progress_time
			FROM streams s
			JOIN stream_state ss ON ss.stream_id = s.uid
			WHERE s.title = ?
			LIMIT 1
		`,
		[title]
	);

	return {
		duration: Number(row[0]),
		progressTime: Number(row[1])
	};
}

function streamProgressByVideoId(db: Database, videoId: string): StreamProgress {
	const row = firstRow(
		db,
		`
			SELECT s.duration, ss.progress_time
			FROM streams s
			JOIN stream_state ss ON ss.stream_id = s.uid
			WHERE s.url = ?
			LIMIT 1
		`,
		[`https://www.youtube.com/watch?v=${videoId}`]
	);

	return {
		duration: Number(row[0]),
		progressTime: Number(row[1])
	};
}

function baseLibreTubeBackup(overrides: Partial<LibreTubeBackup> = {}): LibreTubeBackup {
	return {
		watchHistory: [],
		watchPositions: [],
		subscriptions: [],
		playlistBookmarks: [],
		localPlaylists: [],
		preferences: [],
		...overrides
	};
}

function youtubeWatchUrl(videoId: string): string {
	return `https://www.youtube.com/watch?v=${videoId}`;
}

function insertYoutubeStream(db: Database, {
	uid,
	videoId,
	url,
	title,
	duration = 60,
	uploader = 'Uploader',
	uploadDate = null,
	uploaderUrl = null,
	thumbnailUrl = null
}: {
	uid: number;
	videoId?: string;
	url?: string;
	title: string;
	duration?: number;
	uploader?: string;
	uploadDate?: number | null;
	uploaderUrl?: string | null;
	thumbnailUrl?: string | null;
}): string {
	const streamUrl = url ?? youtubeWatchUrl(videoId || '');
	db.run(
		`INSERT INTO streams (uid, service_id, url, title, stream_type, duration, uploader, uploader_url, thumbnail_url, upload_date)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[uid, SERVICE_ID_YOUTUBE, streamUrl, title, 'VIDEO_STREAM', duration, uploader, uploaderUrl, thumbnailUrl, uploadDate]
	);
	return streamUrl;
}

function insertStreamHistoryRow(db: Database, streamId: number, accessDate: number, repeatCount: number): void {
	db.run(
		'INSERT INTO stream_history (stream_id, access_date, repeat_count) VALUES (?, ?, ?)',
		[streamId, accessDate, repeatCount]
	);
}

function insertStreamStateRow(db: Database, streamId: number, progressTime: number): void {
	db.run(
		'INSERT INTO stream_state (stream_id, progress_time) VALUES (?, ?)',
		[streamId, progressTime]
	);
}

async function createNewPipeBackup(SQL: SqlJsStatic, seed: (db: Database) => void): Promise<File> {
	const db = new SQL.Database();
	createSchema(db);
	seed(db);

	const dbBytes = db.export();
	db.close();

	const zip = new JSZip();
	zip.file('newpipe.db', dbBytes);
	zip.file('preferences.json', '{}');
	zip.file('newpipe.settings', new Uint8Array([1, 2, 3, 4]));

	const backupBytes = await zip.generateAsync({ type: 'uint8array' });
	return new File([Uint8Array.from(backupBytes).buffer], 'newpipe-test.zip', { type: 'application/zip' });
}

async function convertLibreTubeBackupToNewPipe(
	SQL: SqlJsStatic,
	backup: LibreTubeBackup,
	options: { mode?: 'convert' | 'merge'; npFile?: File; playlistBehavior?: string } = {}
): Promise<NewPipeConversion> {
	const libreTubeFile = jsonFile('libretube.json', backup);
	const result = await exportToNewPipe(options.npFile, libreTubeFile, options.mode ?? 'convert', SQL, options.playlistBehavior);
	return loadNewPipeConversionFromZip(SQL, result.data);
}

function collectNumericValues(value: unknown, acc: number[] = []): number[] {
	if (typeof value === 'number' && Number.isFinite(value)) {
		acc.push(value);
		return acc;
	}
	if (Array.isArray(value)) {
		for (const entry of value) collectNumericValues(entry, acc);
		return acc;
	}
	if (value && typeof value === 'object') {
		for (const entry of Object.values(value)) collectNumericValues(entry, acc);
	}
	return acc;
}

/** Arrange colliding playlists in both backup formats for merge regressions. */
async function duplicatePlaylistInputs(SQL: SqlJsStatic) {
	const newPipeFile = await createNewPipeBackup(SQL, (db) => {
		insertYoutubeStream(db, { uid: 1, videoId: 'npVideo', title: 'NP Video' });
		db.run(
			'INSERT INTO playlists (uid, name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?, ?)',
			[10, 'Shared', 0, -1, 0]
		);
		db.run(
			'INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)',
			[10, 1, 0]
		);
		db.run(
			'INSERT INTO remote_playlists (uid, service_id, name, url, thumbnail_url, uploader, display_index, stream_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
			[20, SERVICE_ID_YOUTUBE, 'Shared Remote', 'https://www.youtube.com/playlist?list=NP', null, 'Uploader', 0, 1]
		);
	});

	const libreTubeBackup = baseLibreTubeBackup({
		localPlaylists: [
			{
				playlist: { id: 1, name: 'Shared', thumbnailUrl: '' },
				videos: [
					{
						videoId: 'ltVideo',
						title: 'LT Video',
						uploader: 'Uploader',
						duration: 60,
						uploadDate: '2024-01-01',
						thumbnailUrl: 'https://img.example.com/lt.jpg'
					}
				]
			}
		],
		playlistBookmarks: [
			{
				playlistId: 'LT',
				playlistName: 'Shared Remote',
				url: 'https://www.youtube.com/playlist?list=LT',
				videos: 1
			}
		]
	});

	return { newPipeFile, libreTubeBackup, libreTubeFile: jsonFile('libretube.json', libreTubeBackup) };
}

async function convertLibreTubeArtifactToNewPipe(SQL: SqlJsStatic): Promise<NewPipeConversion> {
	const newPipeFile = await fixtureFile(NEWPIPE_MERGE_BACKUP_FIXTURE, 'application/zip');
	const libreTubeFile = await fixtureFile(LIBRETUBE_BACKUP_FIXTURE, 'application/json');

	const result = await exportToNewPipe(newPipeFile, libreTubeFile, 'merge', SQL);
	return loadNewPipeConversionFromZip(SQL, result.data);
}

/** Create a backup using the older stream-state column order. */
async function createMinimalNewPipeBackup(SQL: SqlJsStatic): Promise<File> {
	return createNewPipeBackup(SQL, db => {
		db.run('DROP TABLE stream_state');
		db.run('CREATE TABLE stream_state (stream_id INTEGER NOT NULL PRIMARY KEY, progress_time INTEGER NOT NULL)');
		insertYoutubeStream(db, { uid: 1, videoId: 'legacyState', title: 'Legacy state stream', duration: 100 });
		insertStreamStateRow(db, 1, 42000);
	});
}

describe('NewPipe/LibreTube conversion regressions', () => {
	test('accepts the real LibreTube backup when validated against the shared schema', async () => {
		const raw = JSON.parse((await readFixture(LIBRETUBE_BACKUP_FIXTURE)).toString('utf8'));

		const result = v.safeParse(LibreTubeBackupSchema, raw);

		expect(result.success).toBe(true);
	});

	test('preserves partial progress and encodes completion when real watch history is imported', async () => {
		const watchedFromSentinel = [
			{
				title: 'The WILDEST Werewolf Game Ever Played | OG Crew',
				expectedDurationSeconds: 3185,
				expectedProgressMillis: 3185000
			},
			{
				title: 'TRUTH OR DRINK | Sam vs Abby',
				expectedDurationSeconds: 2099,
				expectedProgressMillis: 2099000
			}
		];
		const watchedWithoutPosition = [
			{
				videoId: 'gL3BJ8_5Jz8',
				expectedDurationSeconds: 3345,
				expectedProgressMillis: 3345000
			}
		];
		const knownPositions = [
			{
				title: 'Richard Dawson - Ogre (Official Video)',
				expectedDurationSeconds: 416,
				expectedProgressMillis: 416001
			},
			{
				title: 'ericdoa - Ninajirachi freestyle',
				expectedDurationSeconds: 170,
				expectedProgressMillis: 170002
			},
			{
				title: 'Ninajirachi - All I Am (Official Video)',
				expectedDurationSeconds: 192,
				expectedProgressMillis: 862
			}
		];

		const { db } = await convertLibreTubeArtifactToNewPipe(SQL);
		const watchedProgress = watchedFromSentinel.map(({ title }) => streamProgressByTitle(db, title));
		const implicitWatchedProgress = watchedWithoutPosition.map(({ videoId }) => streamProgressByVideoId(db, videoId));
		const knownProgress = knownPositions.map(({ title }) => streamProgressByTitle(db, title));

		expect(watchedProgress).toEqual(
			watchedFromSentinel.map(({ expectedDurationSeconds, expectedProgressMillis }) => ({
				duration: expectedDurationSeconds,
				progressTime: expectedProgressMillis
			}))
		);
		expect(implicitWatchedProgress).toEqual(
			watchedWithoutPosition.map(({ expectedDurationSeconds, expectedProgressMillis }) => ({
				duration: expectedDurationSeconds,
				progressTime: expectedProgressMillis
			}))
		);
		expect(watchedProgress.map(({ progressTime }) => String(progressTime))).not.toContain(WATCHED_SENTINEL);
		expect(implicitWatchedProgress.map(({ progressTime }) => progressTime)).not.toContain(0);
		expect(knownProgress).toEqual(
			knownPositions.map(({ expectedDurationSeconds, expectedProgressMillis }) => ({
				duration: expectedDurationSeconds,
				progressTime: expectedProgressMillis
			}))
		);
	});

	test('encodes finite completion when watch positions use the maximum safe sentinel', async () => {
		const videoId = 'completedVideo';
		const durationSeconds = 90;
		const backup = baseLibreTubeBackup({
			watchHistory: [{ videoId, title: 'Completed', duration: durationSeconds, accessDate: 1700000000 }],
			watchPositions: [{ videoId, position: MAX_SAFE_WATCH_POSITION }]
		});

		const { db } = await convertLibreTubeBackupToNewPipe(sqlite.SQL, backup);
		const progress = streamProgressByVideoId(db, videoId);

		expect(progress).toEqual({ duration: durationSeconds, progressTime: durationSeconds * 1000 });
	});

	test('exports a Room compatible stream state schema when a backup is created', async () => {
		const backup = baseLibreTubeBackup();

		const { db } = await convertLibreTubeBackupToNewPipe(sqlite.SQL, backup);
		const tableInfo = db.exec('PRAGMA table_info("stream_state")')[0].values;
		const foreignKeys = db.exec('PRAGMA foreign_key_list("stream_state")')[0].values;

		expect(tableInfo).toEqual([
			[0, 'progress_time', 'INTEGER', 1, null, 0],
			[1, 'stream_id', 'INTEGER', 1, null, 1]
		]);
		expect(foreignKeys).toEqual([
			[0, 0, 'streams', 'stream_id', 'uid', 'CASCADE', 'CASCADE', 'NONE']
		]);
	});

	test('preserves progress when a legacy stream state schema is upgraded', async () => {
		const legacyNewPipeFile = await createMinimalNewPipeBackup(SQL);
		const emptyLibreTubeFile = jsonFile('empty-libretube.json', {
			watchHistory: [],
			watchPositions: [],
			subscriptions: [],
			playlistBookmarks: [],
			localPlaylists: []
		});

		const result = await exportToNewPipe(legacyNewPipeFile, emptyLibreTubeFile, 'merge', SQL);
		const { db } = await loadNewPipeConversionFromZip(SQL, result.data);

		const tableInfo = db.exec('PRAGMA table_info("stream_state")')[0].values;
		const existingState = firstRow(
			db,
			`
				SELECT ss.progress_time
				FROM stream_state ss
				JOIN streams s ON s.uid = ss.stream_id
				WHERE s.url = ?
			`,
			['https://www.youtube.com/watch?v=legacyState']
		);

		expect(tableInfo).toEqual([
			[0, 'progress_time', 'INTEGER', 1, null, 0],
			[1, 'stream_id', 'INTEGER', 1, null, 1]
		]);
		expect(existingState).toEqual([42000]);
	});

	test('preserves binary settings when a NewPipe backup is merged', async () => {
		const originalSettings = new Uint8Array([1, 2, 3, 4]);
		const source = await createNewPipeBackup(sqlite.SQL, () => {});
		const target = baseLibreTubeBackup();

		const { zip } = await convertLibreTubeBackupToNewPipe(sqlite.SQL, target, { mode: 'merge', npFile: source });
		const convertedSettings = await zip.file('newpipe.settings')!.async('uint8array');
		const convertedPreferences = await zip.file('preferences.json')!.async('string');

		expect(convertedSettings).toEqual(originalSettings);
		expect(convertedPreferences).toBe('{}');
	});

	test('removes dependent feed rows when subscriptions are replaced', async () => {
		const source = await createNewPipeBackup(sqlite.SQL, db => {
			insertYoutubeStream(db, { uid: 1, videoId: 'feedVideo', title: 'Feed video' });
			db.run("INSERT INTO subscriptions (uid, service_id, url, name, subscriber_count, description, notification_mode) VALUES (1, 0, 'https://www.youtube.com/channel/old', 'Old', 0, '', 0)");
			db.run('INSERT INTO feed (stream_id, subscription_id) VALUES (1, 1)');
			// This table exists in exported backups but is absent from createSchema's minimal schema.
			db.run('CREATE TABLE feed_last_updated (subscription_id INTEGER NOT NULL PRIMARY KEY, last_updated INTEGER NOT NULL)');
			db.run('INSERT INTO feed_last_updated VALUES (1, 1700000000000)');
		});
		const backup = baseLibreTubeBackup({ subscriptions: [{ channelId: 'new', url: 'https://www.youtube.com/channel/new', name: 'New' }] });

		const { db } = await convertLibreTubeBackupToNewPipe(sqlite.SQL, backup, { mode: 'merge', npFile: source });
		const feed = firstRow(db, 'SELECT COUNT(*) FROM feed');
		const updates = firstRow(db, 'SELECT COUNT(*) FROM feed_last_updated');
		const subscriptions = db.exec('SELECT name, url FROM subscriptions')[0].values;

		expect(feed).toEqual([0]);
		expect(updates).toEqual([0]);
		expect(subscriptions).toEqual([['New', 'https://www.youtube.com/channel/new']]);
	});

	test('returns undefined when stream and playlist lookups find no match', async () => {
		const db = new SQL.Database();
		createSchema(db);

		const streamId = findStreamIdByServiceUrl(db, SERVICE_ID_YOUTUBE, 'https://www.youtube.com/watch?v=missing');
		const playlistId = findPlaylistIdByName(db, 'missing');
		const remoteId = findRemotePlaylistIdByUrlOrName(db, 'https://www.youtube.com/playlist?list=missing', 'missing');

		expect(streamId).toBeUndefined();
		expect(playlistId).toBeUndefined();
		expect(remoteId).toBeUndefined();
	});

	test('exports history and safe completion sentinels when a real NewPipe backup is converted', async () => {
		const newPipeFile = await fixtureFile(NEWPIPE_MERGE_BACKUP_FIXTURE, 'application/zip');

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

		const watchedVideo = backup.watchHistory.find(item => item.videoId === 'lsvZdADkM5U');
		const watchedPosition = backup.watchPositions.find(item => item.videoId === 'lsvZdADkM5U');

		expect(watchedVideo).toMatchObject({
			videoId: 'lsvZdADkM5U',
			title: 'This Upgrade is Going to Kill Him - AMD $5000 Ultimate Tech Upgrade!',
			duration: 1523
		});
		expect(watchedPosition).toEqual({
			videoId: 'lsvZdADkM5U',
			position: MAX_SAFE_WATCH_POSITION
		});
		expect(backup.watchPositions.every(item => Number.isSafeInteger(Number(item.position)))).toBe(true);
	});

	test('produces valid LibreTube data when a real NewPipe backup is converted', async () => {
		const newPipeFile = await fixtureFile(NEWPIPE_MERGE_BACKUP_FIXTURE, 'application/zip');

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);

		expect(v.safeParse(LibreTubeBackupSchema, JSON.parse(result.jsonText)).success).toBe(true);
	});

	test('preserves valid progress and history rows when backups are merged', async () => {
		const videoId = 'historyVideo';
		const source = await createNewPipeBackup(sqlite.SQL, db => {
			insertYoutubeStream(db, { uid: 1, videoId, title: 'History video', duration: 60 });
			insertStreamHistoryRow(db, 1, 1700000000000, 1);
			insertStreamStateRow(db, 1, 5000);
		});
		const target = baseLibreTubeBackup();

		const { db } = await convertLibreTubeBackupToNewPipe(sqlite.SQL, target, { mode: 'merge', npFile: source });
		const stateRows = selectRows(db, `SELECT s.url, ss.progress_time FROM stream_state ss
			JOIN streams s ON ss.stream_id = s.uid`, NewPipeStateRowSchema);
		const historyRows = selectRows(db, 'SELECT stream_id, access_date, repeat_count FROM stream_history', NewPipeStreamHistoryInsertSchema);

		expect(stateRows).toEqual([{ url: youtubeWatchUrl(videoId), progress_time: 5000 }]);
		expect(historyRows).toEqual([{ stream_id: 1, access_date: 1700000000000, repeat_count: 1 }]);
	});

	test('produces valid database rows when a real LibreTube backup is converted', async () => {
		const libreTubeFile = await fixtureFile(LIBRETUBE_BACKUP_FIXTURE, 'application/json');

		const result = await exportToNewPipe(undefined, libreTubeFile, 'convert', SQL);
		const { db } = await loadNewPipeConversionFromZip(SQL, result.data);

		expect(selectRows(
			db,
			'SELECT service_id, url, name, avatar_url, subscriber_count, description, notification_mode FROM subscriptions',
			NewPipeSubscriptionInsertSchema
		).length).toBeGreaterThan(0);
		expect(selectRows(
			db,
			'SELECT service_id, url, title, stream_type, duration, uploader, upload_date, thumbnail_url FROM streams',
			NewPipeStreamInsertSchema
		).length).toBeGreaterThan(0);
		expect(selectRows(
			db,
			'SELECT name, is_thumbnail_permanent, thumbnail_stream_id, display_index FROM playlists',
			NewPipePlaylistInsertSchema
		).length).toBeGreaterThan(0);
		expect(selectRows(db, 'SELECT playlist_id, stream_id, join_index FROM playlist_stream_join', NewPipePlaylistJoinInsertSchema).length).toBeGreaterThan(0);
		expect(selectRows(
			db,
			'SELECT service_id, name, url, thumbnail_url, uploader, display_index, stream_count FROM remote_playlists',
			NewPipeRemotePlaylistInsertSchema
		).length).toBeGreaterThan(0);
		expect(selectRows(db, 'SELECT progress_time, stream_id FROM stream_state', NewPipeStreamStateInsertSchema).length).toBeGreaterThan(0);
		expect(selectRows(db, 'SELECT stream_id, access_date, repeat_count FROM stream_history', NewPipeStreamHistoryInsertSchema).length).toBeGreaterThan(0);
	});

	test('preserves all playlist videos when upload dates use relative text', async () => {
		const backup = baseLibreTubeBackup({
			localPlaylists: [{
				playlist: { id: 1, name: 'Relative dates' },
				videos: [
					{ videoId: 'first', title: 'First', duration: 60, uploadDate: '2 days ago' },
					{ videoId: 'second', title: 'Second', duration: 120, uploadDate: '1 month ago' }
				]
			}]
		});

		const { db } = await convertLibreTubeBackupToNewPipe(sqlite.SQL, backup);
		const rows = db.exec(`SELECT p.name, s.url, s.title, s.upload_date FROM playlist_stream_join psj
			JOIN playlists p ON p.uid = psj.playlist_id JOIN streams s ON s.uid = psj.stream_id
			ORDER BY psj.join_index`)[0].values;

		expect(rows).toEqual([
			['Relative dates', youtubeWatchUrl('first'), 'First', null],
			['Relative dates', youtubeWatchUrl('second'), 'Second', null]
		]);
	});

	test('creates required tables and the Room identity when an empty backup is converted', async () => {
		const backup = baseLibreTubeBackup();

		const { db } = await convertLibreTubeBackupToNewPipe(SQL, backup);

		const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0].values;
		const tableNames = tables.map(row => row[0]);
		const required = [
			'android_metadata',
			'subscriptions',
			'search_history',
			'streams',
			'stream_history',
			'stream_state',
			'playlist_stream_join',
			'playlists',
			'remote_playlists',
			'feed',
			'feed_group',
			'feed_group_subscription_join',
			'room_master_table'
		];

		const roomMasterRow = firstRow(db, 'SELECT id, identity_hash FROM room_master_table');

		expect(tableNames).toEqual(expect.arrayContaining(required));
		expect(roomMasterRow).toEqual([42, '7591e8039faa74d8c0517dc867af9d3e']);
	});

	test('sets subscription defaults when optional metadata is missing', async () => {
		const channelId = 'UC123';
		const url = `https://www.youtube.com/channel/${channelId}`;
		const libreTubeBackup = baseLibreTubeBackup({
			subscriptions: [
				{
					channelId,
					url,
					name: 'Example Channel'
				}
			]
		});

		const { db } = await convertLibreTubeBackupToNewPipe(SQL, libreTubeBackup);

		const row = firstRow(
			db,
			'SELECT subscriber_count, description, notification_mode FROM subscriptions WHERE url = ?',
			[url]
		);

		expect(row).toEqual([0, '', 0]);
	});

	test('combines repeat counts when URL aliases and nearby watch times overlap', async () => {
		const videoId = 'mergeVideo';
		const accessSeconds = 1700000000;
		const expectedAccessMs = accessSeconds * 1000;

		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, {
				uid: 1,
				videoId,
				title: 'Merge Video'
			});
			insertStreamHistoryRow(db, 1, expectedAccessMs, 2);
		});

		const libreTubeBackup = baseLibreTubeBackup({
			watchHistory: [
				{
					videoId,
					title: 'Merge Video',
					duration: 100,
					accessDate: accessSeconds,
					repeatCount: 3
				},
				{
					url: `https://youtu.be/${videoId}`,
					title: 'Merge Video',
					duration: 100,
					accessDate: accessSeconds + 0.5,
					repeatCount: 1
				}
			]
		});

		const { db } = await convertLibreTubeBackupToNewPipe(SQL, libreTubeBackup, {
			mode: 'merge',
			npFile: newPipeFile
		});

		const row = firstRow(db, 'SELECT access_date, repeat_count FROM stream_history WHERE stream_id = 1');
		const count = firstRow(db, 'SELECT COUNT(*) FROM stream_history WHERE stream_id = 1');

		expect(row).toEqual([expectedAccessMs, 6]);
		expect(count).toEqual([1]);
	});

	test('orders history newest first when watch times differ', async () => {
		const newerVideo = 'newestVideo';
		const olderVideo = 'olderVideo';

		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId: newerVideo, title: 'Newest', duration: 60 });
			insertYoutubeStream(db, { uid: 2, videoId: olderVideo, title: 'Older', duration: 60 });
			insertStreamHistoryRow(db, 1, 1700000005000, 1);
			insertStreamHistoryRow(db, 2, 1700000000000, 1);
		});

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

		expect(backup.watchHistory.map(item => item.videoId)).toEqual([newerVideo, olderVideo]);
	});

	test('exports supported metadata when a history entry has complete stream data', async () => {
		const videoId = 'metaVideo';

		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, {
				uid: 1,
				videoId,
				title: 'Metadata Title',
				duration: 120,
				uploader: 'Metadata Uploader',
				uploadDate: 20230424,
				uploaderUrl: 'https://www.youtube.com/channel/UC_META',
				thumbnailUrl: 'https://img.example.com/thumb.jpg'
			});
			insertStreamHistoryRow(db, 1, 1700000000000, 1);
		});

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));
		const entry = backup.watchHistory.find(item => item.videoId === videoId);

		expect(entry).toMatchObject({
			videoId,
			title: 'Metadata Title',
			uploadDate: '2023-04-24',
			uploader: 'Metadata Uploader',
			uploaderUrl: 'UC_META',
			uploaderAvatar: '',
			thumbnailUrl: 'https://img.example.com/thumb.jpg',
			duration: 120
		});
		expect(entry).not.toHaveProperty('repeatCount');
		expect(entry).not.toHaveProperty('accessDate');
	});

	test('exports ISO dates when upload dates use seconds, milliseconds, or YYYYMMDD', async () => {
		const secondsId = 'uploadSeconds';
		const millisId = 'uploadMillis';
		const ymdId = 'uploadYmd';
		const uploadSeconds = 1700000000;
		const uploadMillis = 1700000000000;
		const uploadYmd = 20230424;

		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, {
				uid: 1,
				videoId: secondsId,
				title: 'Seconds Upload',
				duration: 60,
				uploadDate: uploadSeconds
			});
			insertYoutubeStream(db, {
				uid: 2,
				videoId: millisId,
				title: 'Millis Upload',
				duration: 60,
				uploadDate: uploadMillis
			});
			insertYoutubeStream(db, {
				uid: 3,
				videoId: ymdId,
				title: 'YMD Upload',
				duration: 60,
				uploadDate: uploadYmd
			});
			insertStreamHistoryRow(db, 1, 1700000000000, 1);
			insertStreamHistoryRow(db, 2, 1700000001000, 1);
			insertStreamHistoryRow(db, 3, 1700000002000, 1);
		});

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));
		const entryById = new Map(backup.watchHistory.map(item => [item.videoId, item]));

		const expectedSeconds = new Date(uploadSeconds * 1000).toISOString().split('T')[0];
		const expectedMillis = new Date(uploadMillis).toISOString().split('T')[0];

		expect(entryById.get(secondsId)?.uploadDate).toBe(expectedSeconds);
		expect(entryById.get(millisId)?.uploadDate).toBe(expectedMillis);
		expect(entryById.get(ymdId)?.uploadDate).toBe('2023-04-24');
	});

	test('exports numeric item IDs when a local playlist is converted', async () => {
		const playlistName = 'Numeric IDs';
		const videoId = 'playlistVideo';

		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId, title: 'Playlist Video', duration: 60 });
			db.run(
				'INSERT INTO playlists (uid, name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?, ?)',
				[10, playlistName, 0, -1, 0]
			);
			db.run(
				'INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)',
				[10, 1, 0]
			);
		});

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));
		const playlist = backup.localPlaylists.find(pl => pl.playlist.name === playlistName);

		expect(playlist?.videos.length).toBe(1);
		expect(typeof playlist?.videos[0].id).toBe('number');
		expect(Number.isInteger(playlist?.videos[0].id)).toBe(true);
	});

	test('uses the first video thumbnail when a playlist has no thumbnail', async () => {
		const playlistName = 'LT Playlist';
		const libreTubeBackup = baseLibreTubeBackup({
			localPlaylists: [
				{
					playlist: { id: 1, name: playlistName, thumbnailUrl: '' },
					videos: [
						{
							videoId: 'firstVideo',
							title: 'First Video',
							uploader: 'Uploader',
							duration: 60,
							uploadDate: '2024-01-01',
							thumbnailUrl: 'https://img.example.com/first.jpg'
						},
						{
							videoId: 'secondVideo',
							title: 'Second Video',
							uploader: 'Uploader',
							duration: 60,
							uploadDate: '2024-01-02',
							thumbnailUrl: 'https://img.example.com/second.jpg'
						}
					]
				}
			]
		});

		const { db } = await convertLibreTubeBackupToNewPipe(SQL, libreTubeBackup);

		const row = firstRow(
			db,
			`
				SELECT p.thumbnail_stream_id, psj.stream_id
				FROM playlists p
				JOIN playlist_stream_join psj ON psj.playlist_id = p.uid
				WHERE p.name = ? AND psj.join_index = 0
			`,
			[playlistName]
		);

		expect(row[0]).toBe(row[1]);
		expect(row[0]).toBeGreaterThan(0);
	});

	test('replaces playlists when only LibreTube playlists are requested', async () => {
		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId: 'npVideo', title: 'NP Video' });
			db.run(
				'INSERT INTO playlists (uid, name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?, ?)',
				[10, 'NP Playlist', 0, -1, 0]
			);
			db.run(
				'INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)',
				[10, 1, 0]
			);
			db.run(
				'INSERT INTO remote_playlists (uid, service_id, name, url, thumbnail_url, uploader, display_index, stream_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
				[20, SERVICE_ID_YOUTUBE, 'NP Remote', 'https://www.youtube.com/playlist?list=NP', null, 'Uploader', 0, 1]
			);
		});

		const libreTubeBackup = baseLibreTubeBackup({
			localPlaylists: [
				{
					playlist: { id: 1, name: 'LT Playlist', thumbnailUrl: '' },
					videos: [
						{
							videoId: 'ltVideo',
							title: 'LT Video',
							uploader: 'Uploader',
							duration: 60,
							uploadDate: '2024-01-01',
							thumbnailUrl: 'https://img.example.com/lt.jpg'
						}
					]
				}
			],
			playlistBookmarks: [
				{
					playlistId: 'LT',
					playlistName: 'LT Remote',
					url: 'https://www.youtube.com/playlist?list=LT',
					videos: 1
				}
			]
		});

		const { db } = await convertLibreTubeBackupToNewPipe(SQL, libreTubeBackup, {
			mode: 'merge',
			npFile: newPipeFile,
			playlistBehavior: 'only_libretube'
		});

		const playlists = db.exec('SELECT name FROM playlists')[0].values.map(row => row[0]);
		const remotes = db.exec('SELECT name FROM remote_playlists')[0].values.map(row => row[0]);

		expect(playlists).toEqual(['LT Playlist']);
		expect(remotes).toEqual(['LT Remote']);
	});

	test('preserves playlists when only NewPipe playlists are requested', async () => {
		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId: 'npVideo', title: 'NP Video' });
			db.run(
				'INSERT INTO playlists (uid, name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?, ?)',
				[10, 'NP Playlist', 0, -1, 0]
			);
			db.run(
				'INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)',
				[10, 1, 0]
			);
			db.run(
				'INSERT INTO remote_playlists (uid, service_id, name, url, thumbnail_url, uploader, display_index, stream_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
				[20, SERVICE_ID_YOUTUBE, 'NP Remote', 'https://www.youtube.com/playlist?list=NP', null, 'Uploader', 0, 1]
			);
		});

		const libreTubeBackup = baseLibreTubeBackup({
			localPlaylists: [
				{
					playlist: { id: 1, name: 'LT Playlist', thumbnailUrl: '' },
					videos: [
						{
							videoId: 'ltVideo',
							title: 'LT Video',
							uploader: 'Uploader',
							duration: 60,
							uploadDate: '2024-01-01',
							thumbnailUrl: 'https://img.example.com/lt.jpg'
						}
					]
				}
			],
			playlistBookmarks: [
				{
					playlistId: 'LT',
					playlistName: 'LT Remote',
					url: 'https://www.youtube.com/playlist?list=LT',
					videos: 1
				}
			]
		});

		const { db } = await convertLibreTubeBackupToNewPipe(SQL, libreTubeBackup, {
			mode: 'merge',
			npFile: newPipeFile,
			playlistBehavior: 'only_newpipe'
		});

		const playlists = db.exec('SELECT name FROM playlists')[0].values.map(row => row[0]);
		const remotes = db.exec('SELECT name FROM remote_playlists')[0].values.map(row => row[0]);

		expect(playlists).toEqual(['NP Playlist']);
		expect(remotes).toEqual(['NP Remote']);
	});


	test('replaces target playlists when only NewPipe playlists are requested', async () => {
		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId: 'npVideo', title: 'NP Video' });
			db.run(
				'INSERT INTO playlists (uid, name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?, ?)',
				[10, 'NP Playlist', 0, -1, 0]
			);
			db.run(
				'INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)',
				[10, 1, 0]
			);
			db.run(
				'INSERT INTO remote_playlists (uid, service_id, name, url, thumbnail_url, uploader, display_index, stream_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
				[20, SERVICE_ID_YOUTUBE, 'NP Remote', 'https://www.youtube.com/playlist?list=NP', null, 'Uploader', 0, 1]
			);
		});

		const libreTubeBackup = baseLibreTubeBackup({
			localPlaylists: [
				{
					playlist: { id: 1, name: 'LT Playlist', thumbnailUrl: '' },
					videos: [
						{
							videoId: 'ltVideo',
							title: 'LT Video',
							uploader: 'Uploader',
							duration: 60,
							uploadDate: '2024-01-01',
							thumbnailUrl: 'https://img.example.com/lt.jpg'
						}
					]
				}
			],
			playlistBookmarks: [
				{
					playlistId: 'LT',
					playlistName: 'LT Remote',
					url: 'https://www.youtube.com/playlist?list=LT',
					videos: 1
				}
			]
		});

		const libreTubeFile = jsonFile('libretube.json', libreTubeBackup);
		const result = await exportToLibreTube(newPipeFile, libreTubeFile, 'merge', SQL, 'only_newpipe', true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

		expect(backup.localPlaylists.map(pl => pl.playlist.name)).toEqual(['NP Playlist']);
		expect(backup.playlistBookmarks.map(pl => pl.playlistName || pl.name)).toEqual(['NP Remote']);
	});

	test('preserves target playlists when only LibreTube playlists are requested', async () => {
		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId: 'npVideo', title: 'NP Video' });
			db.run(
				'INSERT INTO playlists (uid, name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?, ?)',
				[10, 'NP Playlist', 0, -1, 0]
			);
			db.run(
				'INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)',
				[10, 1, 0]
			);
		});

		const libreTubeBackup = baseLibreTubeBackup({
			localPlaylists: [
				{
					playlist: { id: 1, name: 'LT Playlist', thumbnailUrl: '' },
					videos: [
						{
							videoId: 'ltVideo',
							title: 'LT Video',
							uploader: 'Uploader',
							duration: 60,
							uploadDate: '2024-01-01',
							thumbnailUrl: 'https://img.example.com/lt.jpg'
						}
					]
				}
			]
		});

		const libreTubeFile = jsonFile('libretube.json', libreTubeBackup);
		const result = await exportToLibreTube(newPipeFile, libreTubeFile, 'merge', SQL, 'only_libretube', true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

		expect(backup.localPlaylists.map(pl => pl.playlist.name)).toEqual(['LT Playlist']);
	});


	test('preserves target history when watch history import is disabled during merge', async () => {
		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId: 'npVideo', title: 'NP Video' });
			insertStreamHistoryRow(db, 1, 1700000000000, 1);
			insertStreamStateRow(db, 1, 5000);
		});

		const libreTubeBackup = baseLibreTubeBackup({
			watchHistory: [
				{
					videoId: 'ltVideo',
					title: 'LT Video',
					uploadDate: '2024-01-01',
					uploader: 'Uploader',
					uploaderUrl: 'UC_LT',
					uploaderAvatar: '',
					thumbnailUrl: 'https://img.example.com/lt.jpg',
					duration: 60
				}
			],
			watchPositions: [
				{
					videoId: 'ltVideo',
					position: 1234
				}
			]
		});

		const libreTubeFile = jsonFile('libretube.json', libreTubeBackup);
		const result = await exportToLibreTube(newPipeFile, libreTubeFile, 'merge', SQL, undefined, false);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

		expect(backup.watchHistory).toEqual(libreTubeBackup.watchHistory);
		expect(backup.watchPositions).toEqual(libreTubeBackup.watchPositions);
	});

	test('omits watch history when watch history import is disabled during conversion', async () => {
		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, { uid: 1, videoId: 'npVideo', title: 'NP Video' });
			insertStreamHistoryRow(db, 1, 1700000000000, 1);
			insertStreamStateRow(db, 1, 5000);
		});

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, false);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

		expect(backup.watchHistory.length).toBe(0);
		expect(backup.watchPositions.length).toBe(0);
	});

	test('clamps numeric fields when NewPipe values exceed the safe integer range', async () => {
		const overflow = Number.MAX_SAFE_INTEGER + 1;

		const newPipeFile = await createNewPipeBackup(SQL, (db) => {
			insertYoutubeStream(db, {
				uid: 1,
				videoId: 'overflowVideo',
				title: 'Overflow Video',
				duration: overflow,
				uploadDate: 1700000000000
			});
			insertStreamHistoryRow(db, 1, overflow, 1);
			insertStreamStateRow(db, 1, overflow);
			db.run(
				'INSERT INTO playlists (uid, name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?, ?)',
				[overflow, 'Overflow Playlist', 0, -1, 0]
			);
			db.run(
				'INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)',
				[overflow, 1, 0]
			);
		});

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));
		const numericValues = collectNumericValues(backup);

		expect(numericValues.length).toBeGreaterThan(0);
		expect(numericValues.every(value => Number.isSafeInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)).toBe(true);
	});

	describe('duplicate playlist precedence', () => {
		test.each([
			['merge_lt_precedence', 'ltVideo', 'LT'],
			['merge_np_precedence', 'npVideo', 'NP']
		] as const)('keeps only %s videos when merging into NewPipe', async (behavior, expectedVideo, expectedRemoteId) => {
			const { newPipeFile, libreTubeBackup } = await duplicatePlaylistInputs(sqlite.SQL);

			const { db } = await convertLibreTubeBackupToNewPipe(sqlite.SQL, libreTubeBackup, {
				mode: 'merge', npFile: newPipeFile, playlistBehavior: behavior
			});
			const playlists = db.exec('SELECT name FROM playlists')[0].values;
			const videos = db.exec(`SELECT s.url FROM playlist_stream_join psj
				JOIN streams s ON s.uid = psj.stream_id ORDER BY psj.join_index`)[0].values;
			const bookmarks = db.exec('SELECT name, url FROM remote_playlists')[0].values;

			expect(playlists).toEqual([['Shared']]);
			expect(videos).toEqual([[youtubeWatchUrl(expectedVideo)]]);
			expect(bookmarks).toEqual([['Shared Remote', `https://www.youtube.com/playlist?list=${expectedRemoteId}`]]);
		});

		test.each([
			['merge_lt_precedence', 'ltVideo'],
			['merge_np_precedence', 'npVideo']
		] as const)('keeps only %s videos when merging into LibreTube', async (behavior, expectedVideo) => {
			const { newPipeFile, libreTubeFile } = await duplicatePlaylistInputs(sqlite.SQL);

			const result = await exportToLibreTube(newPipeFile, libreTubeFile, 'merge', sqlite.SQL, behavior, true);
			const backup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

			expect(backup.localPlaylists).toHaveLength(1);
			expect(backup.localPlaylists[0].playlist.name).toBe('Shared');
			expect(backup.localPlaylists[0].videos.map(video => video.videoId)).toEqual([expectedVideo]);
		});
	});

	describe('invalid backups', () => {
		test.each(['newpipe', 'libretube'] as const)('rejects the %s export when a ZIP lacks newpipe.db', async target => {
			const zip = new JSZip();
			zip.file('preferences.json', '{}');
			const input = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'missing-db.zip');
			const libreTubeFile = jsonFile('libretube.json', baseLibreTubeBackup());

			const convert = () => target === 'newpipe'
				? exportToNewPipe(input, libreTubeFile, 'merge', sqlite.SQL)
				: exportToLibreTube(input, undefined, 'convert', sqlite.SQL);

			await expect(convert()).rejects.toThrow(/newpipe\.db/);
		});

		test.each([
			['JSON is malformed', '{', /LibreTube backup is not valid JSON/],
			['the schema is invalid', '{"watchHistory":"broken"}', /LibreTube backup failed validation.*watchHistory/s]
		])('rejects the export and releases its database when %s', async (_condition, text, expectedError) => {
			const input = new File([text], 'broken.json');

			const convert = () => exportToNewPipe(undefined, input, 'convert', sqlite.SQL);

			await expect(convert()).rejects.toThrow(expectedError);
			expect(sqlite.databases).toHaveLength(1);
			expect(() => sqlite.databases[0].exec('SELECT 1')).toThrow();
		});

		test('rejects a merge and releases its database when the ZIP contains corrupt SQLite data', async () => {
			const zip = new JSZip();
			zip.file('newpipe.db', 'not a database');
			const input = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'broken.zip');
			const libreTubeFile = jsonFile('libretube.json', baseLibreTubeBackup());

			const convert = () => exportToNewPipe(input, libreTubeFile, 'merge', sqlite.SQL);

			await expect(convert()).rejects.toThrow(/file is not a database/);
			expect(sqlite.databases).toHaveLength(1);
			expect(() => sqlite.databases[0].exec('SELECT 1')).toThrow();
		});
	});
});

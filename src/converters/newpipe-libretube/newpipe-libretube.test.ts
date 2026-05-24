import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
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

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures');
const LEGACY_ARTIFACTS_DIR = path.resolve(process.cwd(), '_artifacts');

function fixturePath(filename: string, legacyFilename = filename): string {
	const candidates = [
		path.join(FIXTURES_DIR, filename),
		path.join(LEGACY_ARTIFACTS_DIR, legacyFilename)
	];
	const match = candidates.find(existsSync);
	if (!match) {
		throw new Error(`Missing test fixture. Expected one of: ${candidates.join(', ')}`);
	}
	return match;
}

const LIBRETUBE_BACKUP_PATH = fixturePath(
	'fixture-libretube-backup-2026-05-24-08_41_14.json',
	'libretube-backup-2026-05-24-08_41_14.json'
);
const NEWPIPE_MERGE_BACKUP_PATH = fixturePath(
	'fixture-NewPipeData-20251216_181353.zip',
	'newpipe_used_for_merging-NewPipeData-20251216_181353 (1).zip'
);

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

async function artifactFile(filePath: string, type: string): Promise<File> {
	const data = await readFile(filePath);
	return new File([data], path.basename(filePath), { type });
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

function countLibreTubePlaylistVideos(backup: LibreTubeBackup): number {
	let count = 0;
	for (const playlist of backup.localPlaylists ?? []) {
		for (const video of playlist.videos) {
			if (video.videoId || (video.url && extractVideoIdFromUrl(video.url))) count++;
		}
	}
	return count;
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
	return new File([backupBytes as any], 'newpipe-test.zip', { type: 'application/zip' });
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

async function assertNewPipeDuplicatePlaylistMerge(
	SQL: SqlJsStatic,
	behavior: 'merge_lt_precedence' | 'merge_np_precedence',
	expectedVideo: string,
	expectedRemoteUrl: string
): Promise<void> {
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

	const { db } = await convertLibreTubeBackupToNewPipe(SQL, libreTubeBackup, {
		mode: 'merge',
		npFile: newPipeFile,
		playlistBehavior: behavior
	});

	try {
		const playlistRow = firstRow(
			db,
			`
				SELECT s.url
				FROM playlists p
				JOIN playlist_stream_join psj ON psj.playlist_id = p.uid
				JOIN streams s ON s.uid = psj.stream_id
				WHERE p.name = ?
				ORDER BY psj.join_index
				LIMIT 1
			`,
			['Shared']
		);
		const remoteRow = firstRow(
			db,
			'SELECT url FROM remote_playlists WHERE name = ?',
			['Shared Remote']
		);

		expect(playlistRow).toEqual([youtubeWatchUrl(expectedVideo)]);
		expect(remoteRow).toEqual([expectedRemoteUrl]);
	} finally {
		db.close();
	}
}

async function assertLibreTubeDuplicatePlaylistMerge(
	SQL: SqlJsStatic,
	behavior: 'merge_lt_precedence' | 'merge_np_precedence',
	expectedVideo: string
): Promise<void> {
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
		]
	});

	const libreTubeFile = jsonFile('libretube.json', libreTubeBackup);
	const result = await exportToLibreTube(newPipeFile, libreTubeFile, 'merge', SQL, behavior, true);
	const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));
	const playlist = backup.localPlaylists.find(pl => pl.playlist.name === 'Shared');

	expect(playlist?.videos[0].videoId).toBe(expectedVideo);
}

async function convertLibreTubeArtifactToNewPipe(SQL: SqlJsStatic): Promise<NewPipeConversion> {
	const newPipeFile = await artifactFile(NEWPIPE_MERGE_BACKUP_PATH, 'application/zip');
	const libreTubeFile = await artifactFile(LIBRETUBE_BACKUP_PATH, 'application/json');

	const result = await exportToNewPipe(newPipeFile, libreTubeFile, 'merge', SQL);
	return loadNewPipeConversionFromZip(SQL, result.data);
}

async function createMinimalNewPipeBackup(SQL: SqlJsStatic): Promise<File> {
	const db = new SQL.Database();
	createSchema(db);

	db.run('DROP TABLE stream_state');
	db.run('CREATE TABLE stream_state (stream_id INTEGER NOT NULL PRIMARY KEY, progress_time INTEGER NOT NULL)');
	db.run(
		"INSERT INTO streams (uid, service_id, url, title, stream_type, duration, uploader) VALUES (?, ?, ?, ?, ?, ?, ?)",
		[1, 0, 'https://www.youtube.com/watch?v=legacyState', 'Legacy state stream', 'VIDEO_STREAM', 100, 'Uploader']
	);
	db.run('INSERT INTO stream_state (stream_id, progress_time) VALUES (?, ?)', [1, 42000]);

	const dbBytes = db.export();
	db.close();

	const zip = new JSZip();
	zip.file('newpipe.db', dbBytes);
	zip.file('preferences.json', '{}');
	zip.file('newpipe.settings', new Uint8Array([1, 2, 3, 4]));

	const backupBytes = await zip.generateAsync({ type: 'uint8array' });
	return new File([backupBytes as any], 'legacy-newpipe.zip', { type: 'application/zip' });
}

describe('NewPipe/LibreTube conversion regressions', () => {
	test('fixture_libreTubeBackup_validatesAgainstSharedSchema', async () => {
		const raw = JSON.parse(await readFile(LIBRETUBE_BACKUP_PATH, 'utf8'));
		const result = v.safeParse(LibreTubeBackupSchema, raw);

		expect(result.success).toBe(true);
	});

	test('convertToNewPipe_preservesPartialProgressAndMapsWatchedSentinelsToFiniteFullProgress', async () => {
		// Arrange
		const SQL = await initSqlJs();
		const { db } = await convertLibreTubeArtifactToNewPipe(SQL);

		try {
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

			// Act
			const watchedProgress = watchedFromSentinel.map(({ title }) => streamProgressByTitle(db, title));
			const implicitWatchedProgress = watchedWithoutPosition.map(({ videoId }) => streamProgressByVideoId(db, videoId));
			const knownProgress = knownPositions.map(({ title }) => streamProgressByTitle(db, title));

			// Assert
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
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_mapsMaxSafeWatchPositionsToCompletedProgress', async () => {
		const SQL = await initSqlJs();
		const libreTubeText = await readFile(LIBRETUBE_BACKUP_PATH, 'utf8');
		const libreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(libreTubeText));
		const historyArray = libreTubeBackup.history || libreTubeBackup.watchHistory || libreTubeBackup.watch_history || libreTubeBackup.watch_history_items || [];
		const maxSafeVideoId = 'vrP1ErHYeS0';
		const historyItem = historyArray.find(item => item.videoId === maxSafeVideoId);

		expect(historyItem?.duration).toBeDefined();
		const expectedProgressMillis = Math.floor(Number(historyItem!.duration) * 1000);

		const { db } = await convertLibreTubeArtifactToNewPipe(SQL);

		try {
			const progress = streamProgressByVideoId(db, maxSafeVideoId);

			expect(progress.progressTime).toBe(expectedProgressMillis);
			expect(progress.progressTime).not.toBe(Number.MAX_SAFE_INTEGER);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_exportsRoomCompatibleStreamStateSchema', async () => {
		// Arrange
		const SQL = await initSqlJs();
		const { db } = await convertLibreTubeArtifactToNewPipe(SQL);

		try {
			// Act
			const tableInfo = db.exec('PRAGMA table_info("stream_state")')[0].values;
			const foreignKeys = db.exec('PRAGMA foreign_key_list("stream_state")')[0].values;

			// Assert
			expect(tableInfo).toEqual([
				[0, 'progress_time', 'INTEGER', 1, null, 0],
				[1, 'stream_id', 'INTEGER', 1, null, 1]
			]);
			expect(foreignKeys).toEqual([
				[0, 0, 'streams', 'stream_id', 'uid', 'CASCADE', 'CASCADE', 'NONE']
			]);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_patchesLegacyStreamStateSchemaAndKeepsExistingState', async () => {
		// Arrange
		const SQL = await initSqlJs();
		const legacyNewPipeFile = await createMinimalNewPipeBackup(SQL);
		const emptyLibreTubeFile = jsonFile('empty-libretube.json', {
			watchHistory: [],
			watchPositions: [],
			subscriptions: [],
			playlistBookmarks: [],
			localPlaylists: []
		});

		// Act
		const result = await exportToNewPipe(legacyNewPipeFile, emptyLibreTubeFile, 'merge', SQL);
		const { db } = await loadNewPipeConversionFromZip(SQL, result.data);

		try {
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

			// Assert
			expect(tableInfo).toEqual([
				[0, 'progress_time', 'INTEGER', 1, null, 0],
				[1, 'stream_id', 'INTEGER', 1, null, 1]
			]);
			expect(existingState).toEqual([42000]);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_preservesBinarySettingsFromMergedBackup', async () => {
		// Arrange
		const SQL = await initSqlJs();
		const originalZipBytes = await readFile(NEWPIPE_MERGE_BACKUP_PATH);
		const originalZip = await JSZip.loadAsync(originalZipBytes);
		const originalSettings = await originalZip.file('newpipe.settings')!.async('uint8array');

		// Act
		const { zip } = await convertLibreTubeArtifactToNewPipe(SQL);
		const convertedSettings = await zip.file('newpipe.settings')!.async('uint8array');

		// Assert
		expect(Array.from(convertedSettings)).toEqual(Array.from(originalSettings));
	});

	test('convertToNewPipe_removesFeedRowsForReplacedSubscriptions', async () => {
		// Arrange
		const SQL = await initSqlJs();

		// Act
		const { db } = await convertLibreTubeArtifactToNewPipe(SQL);

		try {
			const orphanedFeedRows = firstRow(
				db,
				`
					SELECT COUNT(*)
					FROM feed f
					LEFT JOIN subscriptions s ON s.uid = f.subscription_id
					WHERE s.uid IS NULL
				`
			);
			const orphanedFeedLastUpdatedRows = firstRow(
				db,
				`
					SELECT COUNT(*)
					FROM feed_last_updated flu
					LEFT JOIN subscriptions s ON s.uid = flu.subscription_id
					WHERE s.uid IS NULL
				`
			);

			// Assert
			expect(orphanedFeedRows).toEqual([0]);
			expect(orphanedFeedLastUpdatedRows).toEqual([0]);
		} finally {
			db.close();
		}
	});

	test('newPipeRepo_missingIdLookupsReturnUndefined', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();
		createSchema(db);

		try {
			expect(findStreamIdByServiceUrl(db, SERVICE_ID_YOUTUBE, 'https://www.youtube.com/watch?v=missing')).toBeUndefined();
			expect(findPlaylistIdByName(db, 'missing')).toBeUndefined();
			expect(findRemotePlaylistIdByUrlOrName(db, 'https://www.youtube.com/playlist?list=missing', 'missing')).toBeUndefined();
		} finally {
			db.close();
		}
	});

	test('convertToLibreTube_exportsHistoryAndSafeWatchPositionsFromNewPipeBackup', async () => {
		// Arrange
		const SQL = await initSqlJs();
		const newPipeFile = await artifactFile(NEWPIPE_MERGE_BACKUP_PATH, 'application/zip');

		// Act
		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);
		const backup: LibreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(result.jsonText));

		const watchedVideo = backup.watchHistory.find(item => item.videoId === 'lsvZdADkM5U');
		const watchedPosition = backup.watchPositions.find(item => item.videoId === 'lsvZdADkM5U');

		// Assert
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

	test('convertToLibreTube_outputValidatesAgainstSharedSchema', async () => {
		const SQL = await initSqlJs();
		const newPipeFile = await artifactFile(NEWPIPE_MERGE_BACKUP_PATH, 'application/zip');

		const result = await exportToLibreTube(newPipeFile, undefined, 'convert', SQL, undefined, true);

		expect(v.safeParse(LibreTubeBackupSchema, JSON.parse(result.jsonText)).success).toBe(true);
	});

	test('generatedNewPipeRows_validateAgainstSharedSchemas', async () => {
		const SQL = await initSqlJs();
		const { db } = await convertLibreTubeArtifactToNewPipe(SQL);

		try {
			const stateRows = selectRows(
				db,
				`
					SELECT s.url, ss.progress_time
					FROM stream_state ss
					JOIN streams s ON ss.stream_id = s.uid
					LIMIT 3
				`,
				NewPipeStateRowSchema
			);
			const historyRows = selectRows(
				db,
				`
					SELECT stream_id, access_date, repeat_count
					FROM stream_history
					LIMIT 3
				`,
				NewPipeStreamHistoryInsertSchema
			);

			expect(stateRows.length).toBeGreaterThan(0);
			expect(historyRows.length).toBeGreaterThan(0);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_generatedDatabaseRowsValidateAgainstSharedSchemas', async () => {
		const SQL = await initSqlJs();
		const libreTubeFile = await artifactFile(LIBRETUBE_BACKUP_PATH, 'application/json');
		const result = await exportToNewPipe(undefined, libreTubeFile, 'convert', SQL);
		const { db } = await loadNewPipeConversionFromZip(SQL, result.data);

		try {
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
			selectRows(db, 'SELECT playlist_id, stream_id, join_index FROM playlist_stream_join', NewPipePlaylistJoinInsertSchema);
			selectRows(
				db,
				'SELECT service_id, name, url, thumbnail_url, uploader, display_index, stream_count FROM remote_playlists',
				NewPipeRemotePlaylistInsertSchema
			);
			expect(selectRows(db, 'SELECT progress_time, stream_id FROM stream_state', NewPipeStreamStateInsertSchema).length).toBeGreaterThan(0);
			expect(selectRows(db, 'SELECT stream_id, access_date, repeat_count FROM stream_history', NewPipeStreamHistoryInsertSchema).length).toBeGreaterThan(0);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_preservesAllLocalPlaylistVideosWithRelativeUploadDates', async () => {
		const SQL = await initSqlJs();
		const libreTubeText = await readFile(LIBRETUBE_BACKUP_PATH, 'utf8');
		const libreTubeBackup = v.parse(LibreTubeBackupSchema, JSON.parse(libreTubeText));
		const libreTubeFile = jsonFile('libretube.json', libreTubeBackup);
		const result = await exportToNewPipe(undefined, libreTubeFile, 'convert', SQL);
		const { db } = await loadNewPipeConversionFromZip(SQL, result.data);

		try {
			const expectedPlaylistVideos = countLibreTubePlaylistVideos(libreTubeBackup);
			const actualPlaylistJoins = Number(firstRow(db, 'SELECT count(*) FROM playlist_stream_join')[0]);

			expect(actualPlaylistJoins).toBe(expectedPlaylistVideos);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_createsRequiredTablesAndSeedsRoomMasterTable', async () => {
		const SQL = await initSqlJs();
		const { db } = await convertLibreTubeBackupToNewPipe(SQL, baseLibreTubeBackup());

		try {
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

			expect(tableNames).toEqual(expect.arrayContaining(required));

			const roomMasterRow = firstRow(db, 'SELECT id, identity_hash FROM room_master_table');
			expect(roomMasterRow).toEqual([42, '7591e8039faa74d8c0517dc867af9d3e']);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_setsSubscriptionDefaults', async () => {
		const SQL = await initSqlJs();
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

		try {
			const row = firstRow(
				db,
				'SELECT subscriber_count, description, notification_mode FROM subscriptions WHERE url = ?',
				[url]
			);
			expect(row).toEqual([0, '', 0]);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_mergesWatchHistoryByUrlAndMillisWindow', async () => {
		const SQL = await initSqlJs();
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

		try {
			const row = firstRow(db, 'SELECT access_date, repeat_count FROM stream_history WHERE stream_id = 1');
			const count = firstRow(db, 'SELECT COUNT(*) FROM stream_history WHERE stream_id = 1');

			expect(row).toEqual([expectedAccessMs, 6]);
			expect(count).toEqual([1]);
		} finally {
			db.close();
		}
	});

	test('convertToLibreTube_sortsWatchHistoryNewestFirst', async () => {
		const SQL = await initSqlJs();
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

	test('convertToLibreTube_includesCompleteWatchHistoryMetadataWithoutExtras', async () => {
		const SQL = await initSqlJs();
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

	test('convertToLibreTube_formatsUploadDatesToIsoDates', async () => {
		const SQL = await initSqlJs();
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

	test('convertToLibreTube_ensuresPlaylistItemIdsAreNumeric', async () => {
		const SQL = await initSqlJs();
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

	test('convertToNewPipe_setsPlaylistThumbnailFromFirstVideo', async () => {
		const SQL = await initSqlJs();
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

		try {
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
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_playlistBehavior_onlyLibretubeOverwritesPlaylists', async () => {
		const SQL = await initSqlJs();
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

		try {
			const playlists = db.exec('SELECT name FROM playlists')[0].values.map(row => row[0]);
			const remotes = db.exec('SELECT name FROM remote_playlists')[0].values.map(row => row[0]);

			expect(playlists).toEqual(['LT Playlist']);
			expect(remotes).toEqual(['LT Remote']);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_playlistBehavior_onlyNewpipePreservesPlaylists', async () => {
		const SQL = await initSqlJs();
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

		try {
			const playlists = db.exec('SELECT name FROM playlists')[0].values.map(row => row[0]);
			const remotes = db.exec('SELECT name FROM remote_playlists')[0].values.map(row => row[0]);

			expect(playlists).toEqual(['NP Playlist']);
			expect(remotes).toEqual(['NP Remote']);
		} finally {
			db.close();
		}
	});

	test('convertToNewPipe_playlistBehavior_mergeLtPrecedence_resolvesDuplicates', async () => {
		const SQL = await initSqlJs();
		await assertNewPipeDuplicatePlaylistMerge(SQL, 'merge_lt_precedence', 'ltVideo', 'https://www.youtube.com/playlist?list=LT');
	});

	test('convertToNewPipe_playlistBehavior_mergeNpPrecedence_resolvesDuplicates', async () => {
		const SQL = await initSqlJs();
		await assertNewPipeDuplicatePlaylistMerge(SQL, 'merge_np_precedence', 'npVideo', 'https://www.youtube.com/playlist?list=NP');
	});

	test('convertToLibreTube_playlistBehavior_onlyNewpipeReplacesTargetPlaylists', async () => {
		const SQL = await initSqlJs();
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

	test('convertToLibreTube_playlistBehavior_onlyLibretubePreservesTargetPlaylists', async () => {
		const SQL = await initSqlJs();
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

	test('convertToLibreTube_playlistBehavior_mergeLtPrecedence_resolvesDuplicates', async () => {
		const SQL = await initSqlJs();
		await assertLibreTubeDuplicatePlaylistMerge(SQL, 'merge_lt_precedence', 'ltVideo');
	});

	test('convertToLibreTube_playlistBehavior_mergeNpPrecedence_resolvesDuplicates', async () => {
		const SQL = await initSqlJs();
		await assertLibreTubeDuplicatePlaylistMerge(SQL, 'merge_np_precedence', 'npVideo');
	});

	test('convertToLibreTube_includeWatchHistoryFalse_preservesTargetHistoryOnMerge', async () => {
		const SQL = await initSqlJs();
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

	test('convertToLibreTube_includeWatchHistoryFalse_skipsHistoryOnGenerate', async () => {
		const SQL = await initSqlJs();
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

	test('convertToLibreTube_clampsAllNumericFieldsToSafeIntegers', async () => {
		const SQL = await initSqlJs();
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
});

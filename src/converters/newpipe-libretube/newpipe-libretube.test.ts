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
});

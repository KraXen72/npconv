import type { Database } from 'sql.js';
import { SERVICE_ID_YOUTUBE } from '../constants';
import { selectOne, selectRows, validatePayload } from './sqljs';
import {
	NewPipeHistoryRowSchema,
	NewPipeIdRowSchema,
	NewPipePlaylistInsertSchema,
	NewPipePlaylistJoinInsertSchema,
	NewPipePlaylistRowSchema,
	NewPipePlaylistVideoRowSchema,
	NewPipeRemotePlaylistInsertSchema,
	NewPipeRemotePlaylistRowSchema,
	NewPipeStateRowSchema,
	NewPipeStreamHistoryInsertSchema,
	NewPipeStreamInsertSchema,
	NewPipeStreamStateInsertSchema,
	NewPipeSubscriptionInsertSchema,
	NewPipeSubscriptionRowSchema,
	type NewPipeHistoryRow,
	type NewPipePlaylistInsert,
	type NewPipePlaylistJoinInsert,
	type NewPipePlaylistRow,
	type NewPipePlaylistVideoRow,
	type NewPipeRemotePlaylistInsert,
	type NewPipeRemotePlaylistRow,
	type NewPipeStateRow,
	type NewPipeStreamHistoryInsert,
	type NewPipeStreamInsert,
	type NewPipeStreamStateInsert,
	type NewPipeSubscriptionInsert,
	type NewPipeSubscriptionRow
} from '../schemas/newpipe';

const CLEARABLE_TABLES = new Set([
	'feed',
	'feed_last_updated',
	'playlist_stream_join',
	'playlists',
	'remote_playlists'
]);

export function tableExists(db: Database, tableName: string): boolean {
	const row = selectOne(db, "SELECT 1 AS uid FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", NewPipeIdRowSchema, [tableName]);
	return Boolean(row);
}

export function clearTableIfExists(db: Database, tableName: string): void {
	if (!CLEARABLE_TABLES.has(tableName)) {
		throw new Error(`Refusing to clear unexpected table: ${tableName}`);
	}
	if (tableExists(db, tableName)) {
		db.run(`DELETE FROM ${tableName}`);
	}
}

export function deleteYoutubeSubscriptions(db: Database): void {
	db.run('DELETE FROM subscriptions WHERE service_id = ?', [SERVICE_ID_YOUTUBE]);
}

export function insertSubscription(db: Database, input: NewPipeSubscriptionInsert): void {
	const row = validatePayload(NewPipeSubscriptionInsertSchema, input, 'NewPipe subscription insert');
	db.run(
		'INSERT INTO subscriptions (service_id, url, name, avatar_url, subscriber_count, description, notification_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[row.service_id, row.url, row.name, row.avatar_url, row.subscriber_count, row.description, row.notification_mode]
	);
}

export function insertStreamIgnore(db: Database, input: NewPipeStreamInsert): void {
	const row = validatePayload(NewPipeStreamInsertSchema, input, 'NewPipe stream insert');
	db.run(
		'INSERT OR IGNORE INTO streams (service_id, url, title, stream_type, duration, uploader, upload_date, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		[row.service_id, row.url, row.title, row.stream_type, row.duration, row.uploader, row.upload_date, row.thumbnail_url]
	);
}

export function findStreamIdByServiceUrl(db: Database, serviceId: number, url: string): number | undefined {
	// selectOne returns undefined for no row; NewPipeIdRowSchema rejects null ids.
	return selectOne(db, 'SELECT uid FROM streams WHERE service_id = ? AND url = ?', NewPipeIdRowSchema, [serviceId, url])?.uid;
}

export function findPlaylistIdByName(db: Database, name: string): number | undefined {
	return selectOne(db, 'SELECT uid FROM playlists WHERE name = ?', NewPipeIdRowSchema, [name])?.uid;
}

export function insertPlaylist(db: Database, input: NewPipePlaylistInsert): number {
	const row = validatePayload(NewPipePlaylistInsertSchema, input, 'NewPipe playlist insert');
	db.run(
		'INSERT INTO playlists (name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?)',
		[row.name, row.is_thumbnail_permanent, row.thumbnail_stream_id, row.display_index]
	);
	const id = selectOne(db, 'SELECT last_insert_rowid() AS uid', NewPipeIdRowSchema)?.uid;
	if (id === undefined) throw new Error('Failed to read inserted playlist id');
	return id;
}

export function insertPlaylistJoin(db: Database, input: NewPipePlaylistJoinInsert): void {
	const row = validatePayload(NewPipePlaylistJoinInsertSchema, input, 'NewPipe playlist join insert');
	db.run('INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)', [row.playlist_id, row.stream_id, row.join_index]);
}

export function updatePlaylistThumbnail(db: Database, playlistId: number, streamId: number): void {
	db.run('UPDATE playlists SET thumbnail_stream_id = ? WHERE uid = ?', [streamId, playlistId]);
}

export function deletePlaylist(db: Database, playlistId: number): void {
	db.run('DELETE FROM playlist_stream_join WHERE playlist_id = ?', [playlistId]);
	db.run('DELETE FROM playlists WHERE uid = ?', [playlistId]);
}

export function findRemotePlaylistIdByUrlOrName(db: Database, url: string, name: string): number | undefined {
	return selectOne(db, 'SELECT uid FROM remote_playlists WHERE url = ? OR name = ?', NewPipeIdRowSchema, [url, name])?.uid;
}

export function deleteRemotePlaylist(db: Database, id: number): void {
	db.run('DELETE FROM remote_playlists WHERE uid = ?', [id]);
}

export function insertRemotePlaylist(db: Database, input: NewPipeRemotePlaylistInsert): void {
	const row = validatePayload(NewPipeRemotePlaylistInsertSchema, input, 'NewPipe remote playlist insert');
	db.run(
		'INSERT INTO remote_playlists (service_id, name, url, thumbnail_url, uploader, display_index, stream_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[row.service_id, row.name, row.url, row.thumbnail_url, row.uploader, row.display_index, row.stream_count]
	);
}

export function insertStreamState(db: Database, input: NewPipeStreamStateInsert): void {
	const row = validatePayload(NewPipeStreamStateInsertSchema, input, 'NewPipe stream_state insert');
	db.run('INSERT OR REPLACE INTO stream_state (progress_time, stream_id) VALUES (?, ?)', [row.progress_time, row.stream_id]);
}

export function insertStreamHistory(db: Database, input: NewPipeStreamHistoryInsert): void {
	const row = validatePayload(NewPipeStreamHistoryInsertSchema, input, 'NewPipe stream_history insert');
	db.run('INSERT OR REPLACE INTO stream_history (stream_id, access_date, repeat_count) VALUES (?, ?, ?)', [row.stream_id, row.access_date, row.repeat_count]);
}

export function selectHistoryNear(db: Database, streamId: number, low: number, high: number): NewPipeStreamHistoryInsert[] {
	return selectRows(db, 'SELECT stream_id, access_date, repeat_count FROM stream_history WHERE stream_id = ? AND access_date BETWEEN ? AND ?', NewPipeStreamHistoryInsertSchema, [streamId, low, high]);
}

export function updateStreamHistoryRepeatCount(db: Database, streamId: number, accessDate: number, repeatCount: number): void {
	db.run('UPDATE stream_history SET repeat_count = ? WHERE stream_id = ? AND access_date = ?', [repeatCount, streamId, accessDate]);
}

export function selectYoutubeSubscriptions(db: Database): NewPipeSubscriptionRow[] {
	return selectRows(db, 'SELECT url, name, avatar_url FROM subscriptions WHERE service_id = ?', NewPipeSubscriptionRowSchema, [SERVICE_ID_YOUTUBE]);
}

export function selectYoutubeRemotePlaylists(db: Database): NewPipeRemotePlaylistRow[] {
	return selectRows(db, 'SELECT name, url, uploader, thumbnail_url, stream_count FROM remote_playlists WHERE service_id = ?', NewPipeRemotePlaylistRowSchema, [SERVICE_ID_YOUTUBE]);
}

export function selectPlaylists(db: Database): NewPipePlaylistRow[] {
	return selectRows(db, 'SELECT uid, name FROM playlists', NewPipePlaylistRowSchema);
}

export function selectPlaylistVideos(db: Database, playlistId: number): NewPipePlaylistVideoRow[] {
	return selectRows(
		db,
		`
			SELECT s.url, s.title, s.duration, s.uploader, s.upload_date, s.thumbnail_url
			FROM playlist_stream_join j
			JOIN streams s ON j.stream_id = s.uid
			WHERE j.playlist_id = ? AND s.service_id = ?
			ORDER BY j.join_index ASC
		`,
		NewPipePlaylistVideoRowSchema,
		[playlistId, SERVICE_ID_YOUTUBE]
	);
}

export function selectYoutubeHistory(db: Database): NewPipeHistoryRow[] {
	return selectRows(
		db,
		'SELECT s.url, s.title, s.duration, s.uploader, s.uploader_url, s.thumbnail_url, s.upload_date, sh.access_date, sh.repeat_count FROM stream_history sh JOIN streams s ON sh.stream_id = s.uid WHERE s.service_id = ?',
		NewPipeHistoryRowSchema,
		[SERVICE_ID_YOUTUBE]
	);
}

export function selectYoutubeStreamStates(db: Database): NewPipeStateRow[] {
	return selectRows(
		db,
		'SELECT s.url, ss.progress_time FROM stream_state ss JOIN streams s ON ss.stream_id = s.uid WHERE s.service_id = ?',
		NewPipeStateRowSchema,
		[SERVICE_ID_YOUTUBE]
	);
}

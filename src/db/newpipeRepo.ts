import type { Database } from 'sql.js';
import { and, asc, between, eq, or } from 'drizzle-orm';
import { SERVICE_ID_YOUTUBE } from '../constants';
import { parseWithSchema } from '../schemas/sql';
import { getNewPipeDb, playlistStreamJoin, playlists, remotePlaylists, streamHistory, streams, streamState, subscriptions } from './newpipeTables';
import {
	NewPipeHistoryRowSchema,
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
	const result = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", [tableName]);
	return Boolean(result[0]?.values.length);
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
	getNewPipeDb(db).delete(subscriptions).where(eq(subscriptions.service_id, SERVICE_ID_YOUTUBE)).run();
}

export function insertSubscription(db: Database, input: NewPipeSubscriptionInsert): void {
	const row = parseWithSchema(NewPipeSubscriptionInsertSchema, input, 'NewPipe subscription insert');
	getNewPipeDb(db).insert(subscriptions).values(row).run();
}

export function insertStreamIgnore(db: Database, input: NewPipeStreamInsert): void {
	const row = parseWithSchema(NewPipeStreamInsertSchema, input, 'NewPipe stream insert');
	getNewPipeDb(db).insert(streams).values(row).onConflictDoNothing().run();
}

export function findStreamIdByServiceUrl(db: Database, serviceId: number, url: string): number | undefined {
	return getNewPipeDb(db)
		.select({ uid: streams.uid })
		.from(streams)
		.where(and(eq(streams.service_id, serviceId), eq(streams.url, url)))
		.get()?.uid;
}

export function findPlaylistIdByName(db: Database, name: string): number | undefined {
	return getNewPipeDb(db).select({ uid: playlists.uid }).from(playlists).where(eq(playlists.name, name)).get()?.uid;
}

export function insertPlaylist(db: Database, input: NewPipePlaylistInsert): number {
	const row = parseWithSchema(NewPipePlaylistInsertSchema, input, 'NewPipe playlist insert');
	getNewPipeDb(db).insert(playlists).values(row).run();
	const id = Number(db.exec('SELECT last_insert_rowid() AS uid')[0]?.values[0]?.[0]);
	if (!Number.isInteger(id)) throw new Error('Failed to read inserted playlist id');
	return id;
}

export function insertPlaylistJoin(db: Database, input: NewPipePlaylistJoinInsert): void {
	const row = parseWithSchema(NewPipePlaylistJoinInsertSchema, input, 'NewPipe playlist join insert');
	getNewPipeDb(db).insert(playlistStreamJoin).values(row).run();
}

export function updatePlaylistThumbnail(db: Database, playlistId: number, streamId: number): void {
	getNewPipeDb(db).update(playlists).set({ thumbnail_stream_id: streamId }).where(eq(playlists.uid, playlistId)).run();
}

export function deletePlaylist(db: Database, playlistId: number): void {
	const orm = getNewPipeDb(db);
	orm.delete(playlistStreamJoin).where(eq(playlistStreamJoin.playlist_id, playlistId)).run();
	orm.delete(playlists).where(eq(playlists.uid, playlistId)).run();
}

export function findRemotePlaylistIdByUrlOrName(db: Database, url: string, name: string): number | undefined {
	return getNewPipeDb(db)
		.select({ uid: remotePlaylists.uid })
		.from(remotePlaylists)
		.where(or(eq(remotePlaylists.url, url), eq(remotePlaylists.name, name)))
		.get()?.uid;
}

export function deleteRemotePlaylist(db: Database, id: number): void {
	getNewPipeDb(db).delete(remotePlaylists).where(eq(remotePlaylists.uid, id)).run();
}

export function insertRemotePlaylist(db: Database, input: NewPipeRemotePlaylistInsert): void {
	const row = parseWithSchema(NewPipeRemotePlaylistInsertSchema, input, 'NewPipe remote playlist insert');
	getNewPipeDb(db).insert(remotePlaylists).values(row).run();
}

export function insertStreamState(db: Database, input: NewPipeStreamStateInsert): void {
	const row = parseWithSchema(NewPipeStreamStateInsertSchema, input, 'NewPipe stream_state insert');
	getNewPipeDb(db).insert(streamState).values(row).onConflictDoUpdate({
		target: streamState.stream_id,
		set: { progress_time: row.progress_time }
	}).run();
}

export function insertStreamHistory(db: Database, input: NewPipeStreamHistoryInsert): void {
	const row = parseWithSchema(NewPipeStreamHistoryInsertSchema, input, 'NewPipe stream_history insert');
	getNewPipeDb(db).insert(streamHistory).values(row).onConflictDoUpdate({
		target: [streamHistory.stream_id, streamHistory.access_date],
		set: { repeat_count: row.repeat_count }
	}).run();
}

export function selectHistoryNear(db: Database, streamId: number, low: number, high: number): NewPipeStreamHistoryInsert[] {
	return getNewPipeDb(db)
		.select({
			stream_id: streamHistory.stream_id,
			access_date: streamHistory.access_date,
			repeat_count: streamHistory.repeat_count
		})
		.from(streamHistory)
		.where(and(eq(streamHistory.stream_id, streamId), between(streamHistory.access_date, low, high)))
		.all()
		.map((row) => parseWithSchema(NewPipeStreamHistoryInsertSchema, row, 'NewPipe stream_history row'));
}

export function updateStreamHistoryRepeatCount(db: Database, streamId: number, accessDate: number, repeatCount: number): void {
	getNewPipeDb(db)
		.update(streamHistory)
		.set({ repeat_count: repeatCount })
		.where(and(eq(streamHistory.stream_id, streamId), eq(streamHistory.access_date, accessDate)))
		.run();
}

export function selectYoutubeSubscriptions(db: Database): NewPipeSubscriptionRow[] {
	return getNewPipeDb(db)
		.select({ url: subscriptions.url, name: subscriptions.name, avatar_url: subscriptions.avatar_url })
		.from(subscriptions)
		.where(eq(subscriptions.service_id, SERVICE_ID_YOUTUBE))
		.all()
		.map((row) => parseWithSchema(NewPipeSubscriptionRowSchema, row, 'NewPipe subscription row'));
}

export function selectYoutubeRemotePlaylists(db: Database): NewPipeRemotePlaylistRow[] {
	return getNewPipeDb(db)
		.select({
			name: remotePlaylists.name,
			url: remotePlaylists.url,
			uploader: remotePlaylists.uploader,
			thumbnail_url: remotePlaylists.thumbnail_url,
			stream_count: remotePlaylists.stream_count
		})
		.from(remotePlaylists)
		.where(eq(remotePlaylists.service_id, SERVICE_ID_YOUTUBE))
		.all()
		.map((row) => parseWithSchema(NewPipeRemotePlaylistRowSchema, row, 'NewPipe remote playlist row'));
}

export function selectPlaylists(db: Database): NewPipePlaylistRow[] {
	return getNewPipeDb(db)
		.select({ uid: playlists.uid, name: playlists.name })
		.from(playlists)
		.all()
		.map((row) => parseWithSchema(NewPipePlaylistRowSchema, row, 'NewPipe playlist row'));
}

export function selectPlaylistVideos(db: Database, playlistId: number): NewPipePlaylistVideoRow[] {
	return getNewPipeDb(db)
		.select({
			url: streams.url,
			title: streams.title,
			duration: streams.duration,
			uploader: streams.uploader,
			upload_date: streams.upload_date,
			thumbnail_url: streams.thumbnail_url
		})
		.from(playlistStreamJoin)
		.innerJoin(streams, eq(playlistStreamJoin.stream_id, streams.uid))
		.where(and(eq(playlistStreamJoin.playlist_id, playlistId), eq(streams.service_id, SERVICE_ID_YOUTUBE)))
		.orderBy(asc(playlistStreamJoin.join_index))
		.all()
		.map((row) => parseWithSchema(NewPipePlaylistVideoRowSchema, row, 'NewPipe playlist video row'));
}

export function selectYoutubeHistory(db: Database): NewPipeHistoryRow[] {
	return getNewPipeDb(db)
		.select({
			url: streams.url,
			title: streams.title,
			duration: streams.duration,
			uploader: streams.uploader,
			uploader_url: streams.uploader_url,
			thumbnail_url: streams.thumbnail_url,
			upload_date: streams.upload_date,
			access_date: streamHistory.access_date,
			repeat_count: streamHistory.repeat_count
		})
		.from(streamHistory)
		.innerJoin(streams, eq(streamHistory.stream_id, streams.uid))
		.where(eq(streams.service_id, SERVICE_ID_YOUTUBE))
		.all()
		.map((row) => parseWithSchema(NewPipeHistoryRowSchema, row, 'NewPipe history row'));
}

export function selectYoutubeStreamStates(db: Database): NewPipeStateRow[] {
	return getNewPipeDb(db)
		.select({ url: streams.url, progress_time: streamState.progress_time })
		.from(streamState)
		.innerJoin(streams, eq(streamState.stream_id, streams.uid))
		.where(eq(streams.service_id, SERVICE_ID_YOUTUBE))
		.all()
		.map((row) => parseWithSchema(NewPipeStateRowSchema, row, 'NewPipe stream state row'));
}

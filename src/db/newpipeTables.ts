import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Database } from 'sql.js';

export const subscriptions = sqliteTable('subscriptions', {
	uid: integer('uid').primaryKey({ autoIncrement: true }).notNull(),
	service_id: integer('service_id').notNull(),
	url: text('url'),
	name: text('name'),
	avatar_url: text('avatar_url'),
	subscriber_count: integer('subscriber_count'),
	description: text('description'),
	notification_mode: integer('notification_mode').notNull()
}, (table) => [
	uniqueIndex('index_subscriptions_service_id_url').on(table.service_id, table.url)
]);

export const streams = sqliteTable('streams', {
	uid: integer('uid').primaryKey({ autoIncrement: true }).notNull(),
	service_id: integer('service_id').notNull(),
	url: text('url').notNull(),
	title: text('title').notNull(),
	stream_type: text('stream_type').notNull(),
	duration: integer('duration').notNull(),
	uploader: text('uploader').notNull(),
	uploader_url: text('uploader_url'),
	thumbnail_url: text('thumbnail_url'),
	view_count: integer('view_count'),
	textual_upload_date: text('textual_upload_date'),
	upload_date: integer('upload_date'),
	is_upload_date_approximation: integer('is_upload_date_approximation')
}, (table) => [
	uniqueIndex('index_streams_service_id_url').on(table.service_id, table.url)
]);

export const streamHistory = sqliteTable('stream_history', {
	stream_id: integer('stream_id').notNull().references(() => streams.uid, { onUpdate: 'cascade', onDelete: 'cascade' }),
	access_date: integer('access_date').notNull(),
	repeat_count: integer('repeat_count').notNull()
}, (table) => [
	primaryKey({ columns: [table.stream_id, table.access_date] })
]);

export const streamState = sqliteTable('stream_state', {
	progress_time: integer('progress_time').notNull(),
	stream_id: integer('stream_id').notNull().references(() => streams.uid, { onUpdate: 'cascade', onDelete: 'cascade' })
}, (table) => [
	primaryKey({ columns: [table.stream_id] })
]);

export const playlists = sqliteTable('playlists', {
	uid: integer('uid').primaryKey({ autoIncrement: true }).notNull(),
	name: text('name'),
	is_thumbnail_permanent: integer('is_thumbnail_permanent').notNull(),
	thumbnail_stream_id: integer('thumbnail_stream_id').notNull(),
	display_index: integer('display_index').notNull()
});

export const playlistStreamJoin = sqliteTable('playlist_stream_join', {
	playlist_id: integer('playlist_id').notNull().references(() => playlists.uid, { onUpdate: 'cascade', onDelete: 'cascade' }),
	stream_id: integer('stream_id').notNull().references(() => streams.uid, { onUpdate: 'cascade', onDelete: 'cascade' }),
	join_index: integer('join_index').notNull()
}, (table) => [
	primaryKey({ columns: [table.playlist_id, table.join_index] }),
	index('index_playlist_stream_join_stream_id').on(table.stream_id),
	uniqueIndex('index_playlist_stream_join_playlist_id_join_index').on(table.playlist_id, table.join_index)
]);

export const remotePlaylists = sqliteTable('remote_playlists', {
	uid: integer('uid').primaryKey({ autoIncrement: true }).notNull(),
	service_id: integer('service_id').notNull(),
	name: text('name'),
	url: text('url'),
	thumbnail_url: text('thumbnail_url'),
	uploader: text('uploader'),
	display_index: integer('display_index').notNull(),
	stream_count: integer('stream_count')
});

export const newPipeSchema = {
	subscriptions,
	streams,
	streamHistory,
	streamState,
	playlists,
	playlistStreamJoin,
	remotePlaylists
};

export type NewPipeDb = SQLJsDatabase<typeof newPipeSchema>;

const dbCache = new WeakMap<Database, NewPipeDb>();

export function getNewPipeDb(db: Database): NewPipeDb {
	const cached = dbCache.get(db);
	if (cached) return cached;

	const orm = drizzle(db, { schema: newPipeSchema });
	dbCache.set(db, orm);
	return orm;
}

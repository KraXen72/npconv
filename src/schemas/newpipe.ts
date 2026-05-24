import * as v from 'valibot';
import { createInsertSchema, createSelectSchema } from 'drizzle-valibot';
import {
	playlistStreamJoin,
	playlists,
	remotePlaylists,
	streamHistory,
	streams,
	streamState,
	subscriptions
} from '../db/newpipeTables';
import { IntegerSchema } from './sql';

const NullableStringSchema = v.nullable(v.string());
const NullableIntegerSchema = v.nullable(IntegerSchema);

const integerColumn = () => IntegerSchema;
const nullableIntegerColumn = () => NullableIntegerSchema;
type NullableKeys<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

export type NewPipeIdRow = Pick<typeof streams.$inferSelect, 'uid'>;
export type NewPipeSubscriptionDbRow = typeof subscriptions.$inferSelect;
export type NewPipeStreamDbRow = typeof streams.$inferSelect;
export type NewPipePlaylistDbRow = typeof playlists.$inferSelect;
export type NewPipePlaylistJoinInsert = typeof playlistStreamJoin.$inferInsert;
export type NewPipeRemotePlaylistDbRow = typeof remotePlaylists.$inferSelect;
export type NewPipeStreamStateInsert = typeof streamState.$inferInsert;
export type NewPipeStreamHistoryInsert = typeof streamHistory.$inferInsert;

export type NewPipeSubscriptionInsert = Pick<NewPipeSubscriptionDbRow, 'service_id' | 'url' | 'name' | 'avatar_url' | 'description' | 'notification_mode'> & {
	subscriber_count: number;
};

export type NewPipeStreamInsert = Pick<NewPipeStreamDbRow, 'service_id' | 'url' | 'title' | 'duration' | 'uploader' | 'upload_date' | 'thumbnail_url'> & {
	stream_type: 'VIDEO_STREAM';
};

export type NewPipePlaylistInsert = Pick<NewPipePlaylistDbRow, 'name' | 'is_thumbnail_permanent' | 'thumbnail_stream_id' | 'display_index'>;

export type NewPipeRemotePlaylistInsert = Pick<NewPipeRemotePlaylistDbRow, 'service_id' | 'name' | 'url' | 'thumbnail_url' | 'uploader' | 'display_index'> & {
	stream_count: number;
};

const NewPipeSubscriptionInsertBaseSchema = v.pick(createSelectSchema(subscriptions, {
	service_id: integerColumn,
	notification_mode: integerColumn
}), ['service_id', 'url', 'name', 'avatar_url', 'subscriber_count', 'description', 'notification_mode']);

const NewPipeRemotePlaylistInsertBaseSchema = v.pick(createSelectSchema(remotePlaylists, {
	service_id: integerColumn,
	display_index: integerColumn
}), ['service_id', 'name', 'url', 'thumbnail_url', 'uploader', 'display_index', 'stream_count']);

export const NewPipeIdRowSchema = v.object({
	uid: IntegerSchema
});

export const NewPipeSubscriptionDbSchema = createSelectSchema(subscriptions, {
	uid: integerColumn,
	service_id: integerColumn,
	subscriber_count: nullableIntegerColumn,
	notification_mode: integerColumn
});
export const NewPipeSubscriptionInsertSchema: v.GenericSchema<unknown, NewPipeSubscriptionInsert> = v.object({
	...NewPipeSubscriptionInsertBaseSchema.entries,
	subscriber_count: IntegerSchema
});

export const NewPipeStreamDbSchema = createSelectSchema(streams, {
	uid: integerColumn,
	service_id: integerColumn,
	stream_type: v.string(),
	duration: integerColumn,
	view_count: nullableIntegerColumn,
	upload_date: nullableIntegerColumn,
	is_upload_date_approximation: nullableIntegerColumn
});
export const NewPipeStreamInsertSchema: v.GenericSchema<unknown, NewPipeStreamInsert> = v.pick(createSelectSchema(streams, {
	service_id: integerColumn,
	stream_type: v.literal('VIDEO_STREAM'),
	duration: integerColumn,
	upload_date: nullableIntegerColumn
}), ['service_id', 'url', 'title', 'stream_type', 'duration', 'uploader', 'upload_date', 'thumbnail_url']);

export const NewPipePlaylistDbSchema = createSelectSchema(playlists, {
	uid: integerColumn,
	is_thumbnail_permanent: integerColumn,
	thumbnail_stream_id: integerColumn,
	display_index: integerColumn
});
export const NewPipePlaylistInsertSchema: v.GenericSchema<unknown, NewPipePlaylistInsert> = v.pick(createSelectSchema(playlists, {
	is_thumbnail_permanent: integerColumn,
	thumbnail_stream_id: integerColumn,
	display_index: integerColumn
}), ['name', 'is_thumbnail_permanent', 'thumbnail_stream_id', 'display_index']);

export const NewPipePlaylistJoinDbSchema = createSelectSchema(playlistStreamJoin, {
	playlist_id: integerColumn,
	stream_id: integerColumn,
	join_index: integerColumn
});
export const NewPipePlaylistJoinInsertSchema: v.GenericSchema<unknown, NewPipePlaylistJoinInsert> = createInsertSchema(playlistStreamJoin, {
	playlist_id: integerColumn,
	stream_id: integerColumn,
	join_index: integerColumn
});

export const NewPipeRemotePlaylistDbSchema = createSelectSchema(remotePlaylists, {
	uid: integerColumn,
	service_id: integerColumn,
	display_index: integerColumn,
	stream_count: nullableIntegerColumn
});
export const NewPipeRemotePlaylistInsertSchema: v.GenericSchema<unknown, NewPipeRemotePlaylistInsert> = v.object({
	...NewPipeRemotePlaylistInsertBaseSchema.entries,
	stream_count: IntegerSchema
});

export const NewPipeStreamStateDbSchema = createSelectSchema(streamState, {
	progress_time: integerColumn,
	stream_id: integerColumn
});
export const NewPipeStreamStateInsertSchema: v.GenericSchema<unknown, NewPipeStreamStateInsert> = createInsertSchema(streamState, {
	progress_time: integerColumn,
	stream_id: integerColumn
});

export const NewPipeStreamHistoryDbSchema = createSelectSchema(streamHistory, {
	stream_id: integerColumn,
	access_date: integerColumn,
	repeat_count: integerColumn
});
export const NewPipeStreamHistoryInsertSchema: v.GenericSchema<unknown, NewPipeStreamHistoryInsert> = createInsertSchema(streamHistory, {
	stream_id: integerColumn,
	access_date: integerColumn,
	repeat_count: integerColumn
});

export const NewPipeSubscriptionRowSchema = v.object({
	url: NullableStringSchema,
	name: NullableStringSchema,
	avatar_url: NullableStringSchema
});
export type NewPipeSubscriptionRow = Pick<NewPipeSubscriptionDbRow, 'url' | 'name' | 'avatar_url'>;

export const NewPipeRemotePlaylistRowSchema = v.object({
	name: NullableStringSchema,
	url: NullableStringSchema,
	uploader: NullableStringSchema,
	thumbnail_url: NullableStringSchema,
	stream_count: NullableIntegerSchema
});
export type NewPipeRemotePlaylistRow = Pick<NewPipeRemotePlaylistDbRow, 'name' | 'url' | 'uploader' | 'thumbnail_url' | 'stream_count'>;

export const NewPipePlaylistRowSchema = v.object({
	uid: IntegerSchema,
	name: NullableStringSchema
});
export type NewPipePlaylistRow = Pick<NewPipePlaylistDbRow, 'uid' | 'name'>;

export const NewPipePlaylistVideoRowSchema = v.object({
	url: v.string(),
	title: v.string(),
	duration: IntegerSchema,
	uploader: v.string(),
	upload_date: NullableIntegerSchema,
	thumbnail_url: NullableStringSchema
});
export type NewPipePlaylistVideoRow = Pick<NewPipeStreamDbRow, 'url' | 'title' | 'duration' | 'uploader' | 'upload_date' | 'thumbnail_url'>;

export const NewPipeHistoryRowSchema = v.object({
	url: v.string(),
	title: NullableStringSchema,
	duration: NullableIntegerSchema,
	uploader: NullableStringSchema,
	uploader_url: NullableStringSchema,
	thumbnail_url: NullableStringSchema,
	upload_date: NullableIntegerSchema,
	access_date: IntegerSchema,
	repeat_count: IntegerSchema
});
export type NewPipeHistoryRow = NullableKeys<Pick<NewPipeStreamDbRow, 'url' | 'title' | 'duration' | 'uploader' | 'uploader_url' | 'thumbnail_url' | 'upload_date'>, 'title' | 'duration' | 'uploader'> &
	Pick<NewPipeStreamHistoryInsert, 'access_date' | 'repeat_count'>;

export const NewPipeStateRowSchema = v.object({
	url: v.string(),
	progress_time: IntegerSchema
});
export type NewPipeStateRow = Pick<NewPipeStreamDbRow, 'url'> & Pick<NewPipeStreamStateInsert, 'progress_time'>;

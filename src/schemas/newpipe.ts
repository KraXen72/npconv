import * as v from 'valibot';
import { IntegerSchema } from './sql';

const NullableStringSchema = v.nullable(v.string());
const NullableIntegerSchema = v.nullable(IntegerSchema);

export const NewPipeIdRowSchema = v.object({
	uid: IntegerSchema
});
export type NewPipeIdRow = v.InferOutput<typeof NewPipeIdRowSchema>;

export const NewPipeSubscriptionInsertSchema = v.object({
	service_id: IntegerSchema,
	url: v.string(),
	name: v.string(),
	avatar_url: NullableStringSchema,
	subscriber_count: IntegerSchema,
	description: v.string(),
	notification_mode: IntegerSchema
});
export type NewPipeSubscriptionInsert = v.InferOutput<typeof NewPipeSubscriptionInsertSchema>;

export const NewPipeStreamInsertSchema = v.object({
	service_id: IntegerSchema,
	url: v.string(),
	title: v.string(),
	stream_type: v.literal('VIDEO_STREAM'),
	duration: IntegerSchema,
	uploader: v.string(),
	upload_date: NullableIntegerSchema,
	thumbnail_url: NullableStringSchema
});
export type NewPipeStreamInsert = v.InferOutput<typeof NewPipeStreamInsertSchema>;

export const NewPipePlaylistInsertSchema = v.object({
	name: v.string(),
	is_thumbnail_permanent: IntegerSchema,
	thumbnail_stream_id: IntegerSchema,
	display_index: IntegerSchema
});
export type NewPipePlaylistInsert = v.InferOutput<typeof NewPipePlaylistInsertSchema>;

export const NewPipePlaylistJoinInsertSchema = v.object({
	playlist_id: IntegerSchema,
	stream_id: IntegerSchema,
	join_index: IntegerSchema
});
export type NewPipePlaylistJoinInsert = v.InferOutput<typeof NewPipePlaylistJoinInsertSchema>;

export const NewPipeRemotePlaylistInsertSchema = v.object({
	service_id: IntegerSchema,
	name: v.string(),
	url: v.string(),
	thumbnail_url: NullableStringSchema,
	uploader: v.string(),
	display_index: IntegerSchema,
	stream_count: IntegerSchema
});
export type NewPipeRemotePlaylistInsert = v.InferOutput<typeof NewPipeRemotePlaylistInsertSchema>;

export const NewPipeStreamStateInsertSchema = v.object({
	progress_time: IntegerSchema,
	stream_id: IntegerSchema
});
export type NewPipeStreamStateInsert = v.InferOutput<typeof NewPipeStreamStateInsertSchema>;

export const NewPipeStreamHistoryInsertSchema = v.object({
	stream_id: IntegerSchema,
	access_date: IntegerSchema,
	repeat_count: IntegerSchema
});
export type NewPipeStreamHistoryInsert = v.InferOutput<typeof NewPipeStreamHistoryInsertSchema>;

export const NewPipeSubscriptionRowSchema = v.object({
	url: NullableStringSchema,
	name: NullableStringSchema,
	avatar_url: NullableStringSchema
});
export type NewPipeSubscriptionRow = v.InferOutput<typeof NewPipeSubscriptionRowSchema>;

export const NewPipeRemotePlaylistRowSchema = v.object({
	name: NullableStringSchema,
	url: NullableStringSchema,
	uploader: NullableStringSchema,
	thumbnail_url: NullableStringSchema,
	stream_count: NullableIntegerSchema
});
export type NewPipeRemotePlaylistRow = v.InferOutput<typeof NewPipeRemotePlaylistRowSchema>;

export const NewPipePlaylistRowSchema = v.object({
	uid: IntegerSchema,
	name: NullableStringSchema
});
export type NewPipePlaylistRow = v.InferOutput<typeof NewPipePlaylistRowSchema>;

export const NewPipePlaylistVideoRowSchema = v.object({
	url: v.string(),
	title: v.string(),
	duration: IntegerSchema,
	uploader: v.string(),
	upload_date: NullableIntegerSchema,
	thumbnail_url: NullableStringSchema
});
export type NewPipePlaylistVideoRow = v.InferOutput<typeof NewPipePlaylistVideoRowSchema>;

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
export type NewPipeHistoryRow = v.InferOutput<typeof NewPipeHistoryRowSchema>;

export const NewPipeStateRowSchema = v.object({
	url: v.string(),
	progress_time: IntegerSchema
});
export type NewPipeStateRow = v.InferOutput<typeof NewPipeStateRowSchema>;

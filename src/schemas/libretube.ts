import * as v from 'valibot';
import { IntegerSchema, OptionalNumberSchema, OptionalStringSchema, OptionalUnknownArraySchema } from './sql';

const OptionalStringOrNumberSchema = v.optional(v.union([v.string(), v.number()]));

export const LibreTubeSubscriptionSchema = v.looseObject({
	channelId: v.string(),
	url: v.string(),
	name: v.string(),
	avatar: OptionalStringSchema,
	avatarUrl: OptionalStringSchema,
	verified: v.optional(v.boolean()),
	subscriberCount: OptionalNumberSchema,
	description: OptionalStringSchema,
	notificationMode: OptionalNumberSchema
});
export type LibreTubeSubscription = v.InferOutput<typeof LibreTubeSubscriptionSchema>;

export const LibreTubePlaylistBookmarkSchema = v.looseObject({
	playlistId: v.string(),
	playlistName: OptionalStringSchema,
	name: OptionalStringSchema,
	thumbnailUrl: OptionalStringSchema,
	uploader: OptionalStringSchema,
	uploaderUrl: OptionalStringSchema,
	videos: OptionalNumberSchema,
	url: OptionalStringSchema
});
export type LibreTubePlaylistBookmark = v.InferOutput<typeof LibreTubePlaylistBookmarkSchema>;

export const LibreTubeVideoSchema = v.looseObject({
	id: v.optional(IntegerSchema),
	playlistId: v.optional(IntegerSchema),
	videoId: OptionalStringSchema,
	title: OptionalStringSchema,
	uploadDate: OptionalStringSchema,
	uploader: OptionalStringSchema,
	thumbnailUrl: OptionalStringSchema,
	duration: OptionalNumberSchema,
	url: OptionalStringSchema
});
export type LibreTubeVideo = v.InferOutput<typeof LibreTubeVideoSchema>;

export const LibreTubeLocalPlaylistSchema = v.looseObject({
	playlist: v.looseObject({
		id: IntegerSchema,
		name: v.string(),
		thumbnailUrl: OptionalStringSchema
	}),
	videos: v.array(LibreTubeVideoSchema)
});
export type LibreTubeLocalPlaylist = v.InferOutput<typeof LibreTubeLocalPlaylistSchema>;

export const LibreTubeWatchPositionSchema = v.looseObject({
	videoId: v.string(),
	position: v.union([v.number(), v.string()])
});
export type LibreTubeWatchPosition = v.InferOutput<typeof LibreTubeWatchPositionSchema>;

export const LibreTubeHistoryItemSchema = v.looseObject({
	videoId: OptionalStringSchema,
	videoIdStr: OptionalStringSchema,
	id: OptionalStringSchema,
	url: OptionalStringSchema,
	title: OptionalStringSchema,
	name: OptionalStringSchema,
	uploadDate: OptionalStringOrNumberSchema,
	uploader: OptionalStringSchema,
	uploaderName: OptionalStringSchema,
	uploaderUrl: OptionalStringSchema,
	uploaderAvatar: OptionalStringSchema,
	thumbnailUrl: OptionalStringSchema,
	thumbnail: OptionalStringSchema,
	duration: OptionalNumberSchema,
	length: OptionalNumberSchema,
	accessDate: OptionalStringOrNumberSchema,
	accessedAt: OptionalStringOrNumberSchema,
	lastWatched: OptionalStringOrNumberSchema,
	timestamp: OptionalStringOrNumberSchema,
	date: OptionalStringOrNumberSchema,
	time: OptionalStringOrNumberSchema,
	currentTime: OptionalNumberSchema,
	position: OptionalNumberSchema,
	progress: OptionalNumberSchema,
	repeatCount: OptionalNumberSchema,
	watchCount: OptionalNumberSchema,
	playCount: OptionalNumberSchema,
	repeat_count: OptionalNumberSchema
});
export type LibreTubeHistoryItem = v.InferOutput<typeof LibreTubeHistoryItemSchema>;

export const LibreTubeBackupSchema = v.looseObject({
	watchHistory: v.optional(v.array(LibreTubeHistoryItemSchema), []),
	history: v.optional(v.array(LibreTubeHistoryItemSchema)),
	watch_history: v.optional(v.array(LibreTubeHistoryItemSchema)),
	watch_history_items: v.optional(v.array(LibreTubeHistoryItemSchema)),
	subscriptions: v.optional(v.array(LibreTubeSubscriptionSchema), []),
	playlistBookmarks: v.optional(v.array(LibreTubePlaylistBookmarkSchema), []),
	localPlaylists: v.optional(v.array(LibreTubeLocalPlaylistSchema), []),
	preferences: OptionalUnknownArraySchema,
	watchPositions: v.optional(v.array(LibreTubeWatchPositionSchema), []),
	otherPlaylistKeys: v.optional(v.record(v.string(), v.unknown()))
});
export type LibreTubeBackup = v.InferOutput<typeof LibreTubeBackupSchema>;

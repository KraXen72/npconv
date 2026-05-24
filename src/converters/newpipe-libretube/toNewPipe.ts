import JSZip from 'jszip';
import type { Database, SqlJsStatic } from 'sql.js';
import { DEFAULT_PREFERENCES, SERVICE_ID_YOUTUBE } from '../../constants';
import { log } from '../../logger';
import { createSchema, ensureStreamStateSchema, collectStreamStateDebug } from '../../sqlHelper';
import type { LibreTubeBackup, LibreTubeHistoryItem, LibreTubeLocalPlaylist, LibreTubePlaylistBookmark, LibreTubeWatchPosition } from '../../schemas/libretube';
import { downloadFile, extractVideoIdFromUrl, getTimestamp } from '../../utils';
import { parseJsonWithSchema } from '../../schemas/sql';
import { LibreTubeBackupSchema } from '../../schemas/libretube';
import {
	clearTableIfExists,
	deletePlaylist,
	deleteRemotePlaylist,
	deleteYoutubeSubscriptions,
	findPlaylistIdByName,
	findRemotePlaylistIdByUrlOrName,
	findStreamIdByServiceUrl,
	insertPlaylist,
	insertPlaylistJoin,
	insertRemotePlaylist,
	insertStreamHistory,
	insertStreamIgnore,
	insertStreamState,
	insertSubscription,
	selectHistoryNear,
	updatePlaylistThumbnail,
	updateStreamHistoryRepeatCount
} from '../../db/newpipeRepo';

const LIBRETUBE_WATCHED_POSITION_SENTINEL = '9223372036854775807';
const LIBRETUBE_WATCHED_POSITION_SENTINEL_BIGINT = 9223372036854775807n;

function isNewPipeWatchedSentinel(value: unknown): boolean {
	const raw = String(value ?? '').trim();
	if (!raw) return false;
	if (raw === LIBRETUBE_WATCHED_POSITION_SENTINEL) return true;

	if (/^\d+$/.test(raw)) {
		try {
			return BigInt(raw) >= LIBRETUBE_WATCHED_POSITION_SENTINEL_BIGINT;
		} catch {
			// Fall back to Number handling below.
		}
	}

	const numeric = Number(raw);
	return Number.isFinite(numeric) && numeric >= Number.MAX_SAFE_INTEGER;
}

function completedProgressTime(vid: LibreTubeHistoryItem): number {
	const duration = Number(vid.duration ?? vid.length ?? 0);
	return Number.isFinite(duration) && duration > 0 ? Math.floor(duration * 1000) : 0;
}

function normalizeLibreTubePosition(value: unknown, vid: LibreTubeHistoryItem): number {
	if (isNewPipeWatchedSentinel(value)) return completedProgressTime(vid);

	const position = Number(value || 0);
	if (!Number.isFinite(position) || position <= 0) return 0;
	return Math.floor(position);
}

function historyItemProgressTime(vid: LibreTubeHistoryItem, mappedPosition: unknown): number {
	if (mappedPosition !== undefined && mappedPosition !== null) {
		return normalizeLibreTubePosition(mappedPosition, vid);
	}

	const progressSeconds = vid.currentTime ?? vid.position ?? vid.progress;
	if (progressSeconds !== undefined && progressSeconds !== null) {
		const progress = Number(progressSeconds);
		return Number.isFinite(progress) && progress > 0 ? Math.floor(progress * 1000) : 0;
	}

	return completedProgressTime(vid);
}

export interface NewPipeExportResult {
	data: Uint8Array;
	filename: string;
}

export async function exportToNewPipe(npFile: File | undefined, ltFile: File, mode: string, SQL: SqlJsStatic, playlistBehavior?: string): Promise<NewPipeExportResult> {
	log("Starting conversion to NewPipe format...");

	let db: Database;
	let zip = new JSZip();
	let streamStateDebug = '';
	let existingPreferences: string | null = null;
	let existingSettings: Uint8Array | null = null;
	// playlist behavior passed from UI
	const pb = playlistBehavior || null;
	let skipPlaylistImport = false;

	// 1. Setup DB
	if (mode === 'merge' && npFile) {
		log("Loading existing NewPipe backup...");
		const npData = await npFile.arrayBuffer();
		const sourceZip = await JSZip.loadAsync(npData);

		const newpipeDbFile = sourceZip.file("newpipe.db");
		if (newpipeDbFile) {
			const dbData = await newpipeDbFile.async("uint8array");
			db = new SQL.Database(dbData);
			log("Database loaded. Running integrity check...");
			const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
			if (tablesRes && tablesRes[0] && tablesRes[0].values) {
				log(`Existing NewPipe database contains: ${tablesRes[0].values.flat().join(', ')} tables.`, "schema");
			}

			try {
				ensureStreamStateSchema(db);
				streamStateDebug = collectStreamStateDebug(db);
			} catch (e: any) {
				log("Warning: failed to ensure stream_state schema: " + (e.message || e.toString()), "warn");
			}

		} else {
			throw new Error("Invalid NewPipe backup: missing newpipe.db");
		}

		const prefFile = sourceZip.file("preferences.json");
		if (prefFile) {
			existingPreferences = await prefFile.async("string");
		}
		const settingsFile = sourceZip.file("newpipe.settings");
		if (settingsFile) {
			existingSettings = await settingsFile.async("uint8array");
		}

	} else {
		log("Creating new NewPipe database...");
		db = new SQL.Database();
		createSchema(db);
		streamStateDebug = collectStreamStateDebug(db);
	}

	// 2. Load LibreTube Data
	log("Parsing LibreTube JSON...");
	const ltText = await ltFile.text();
	const ltData: LibreTubeBackup = parseJsonWithSchema(LibreTubeBackupSchema, ltText, 'LibreTube backup');

	db.run("BEGIN TRANSACTION");

	// --- Subscriptions ---
	try {
		log("Processing Subscriptions...");
		if (mode === 'merge') {
			clearTableIfExists(db, 'feed');
			clearTableIfExists(db, 'feed_last_updated');
			deleteYoutubeSubscriptions(db);
		}

		let subCount = 0;
		if (ltData.subscriptions) {
			ltData.subscriptions.forEach(sub => {
				try {
					const url = sub.url || `https://www.youtube.com/channel/${sub.channelId}`;
					const name = sub.name || "Unknown";
					const avatarUrl = sub.avatar || sub.avatarUrl || null;
					if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
						log(`Dropped non-YouTube subscription: ${name} (${url})`, "warn");
						return;
					}

					insertSubscription(db, {
						service_id: SERVICE_ID_YOUTUBE,
						url,
						name,
						avatar_url: avatarUrl,
						subscriber_count: 0,
						description: "",
						notification_mode: 0
					});
					subCount++;
				} catch (e: any) {
					log(`ERROR inserting subscription ${sub.name}: ${e.message || e.toString()}`, "err");
				}
			});
		}
		log(`Inserted ${subCount} subscriptions.`);
	} catch (e: any) {
		log(`FATAL ERROR during Subscriptions phase: ${e.message || e.toString()}`, "err");
		throw e;
	}

	// --- Playlists ---
	try {
		log("Processing Playlists...");
		// Handle playlist behavior for merges. Values expected from UI:
		// 'merge_np_precedence', 'merge_lt_precedence', 'only_newpipe', 'only_libretube'
		if (mode === 'merge') {
			if (pb === 'only_libretube') {
				db.run("DELETE FROM playlist_stream_join");
				db.run("DELETE FROM playlists");
				db.run("DELETE FROM remote_playlists");
				log("Cleared existing playlists; will import only LibreTube playlists.");
			} else if (pb === 'only_newpipe') {
				// preserve existing NewPipe playlists and don't import any from LibreTube
				skipPlaylistImport = true;
				log("Preserving existing NewPipe playlists; skipping import from LibreTube.");
			} else {
				// For merge precedence modes, handle conflicts per-playlist below.
				log(`Merging playlists with behavior: ${pb || 'default (LibreTube precedence)'}`);
			}
		}

		let plCount = 0;
		if (ltData.localPlaylists && !skipPlaylistImport) {
			const localPlaylists: LibreTubeLocalPlaylist[] = ltData.localPlaylists;
			for (const lp of localPlaylists) {
				const plName = lp.playlist.name || "Untitled";
				try {
					const existingId = findPlaylistIdByName(db, plName);
					if (existingId !== undefined) {
						// Duplicate exists in target: respect precedence
						if (pb === 'merge_lt_precedence') {
							try {
								deletePlaylist(db, existingId);
								log(`Replaced existing local playlist: ${plName}`, "schema");
							} catch (e: any) {
								log(`WARN: failed to replace playlist ${plName}: ${e.message || e.toString()}`, "warn");
							}
						} else {
							log(`Skipping duplicate local playlist: ${plName}`, "warn");
							continue;
						}
					}

					const plId = insertPlaylist(db, {
						name: plName,
						is_thumbnail_permanent: 0,
						thumbnail_stream_id: -1,
						display_index: plCount
					});

					let joinIndex = 0;
					for (const vid of lp.videos) {
						const videoId = vid.videoId || (vid.url ? extractVideoIdFromUrl(vid.url) : null);
						if (!videoId) {
							log(`Skipped video in playlist ${plName} due to missing videoId.`, "warn");
							continue;
						}
						const vidUrl = `https://www.youtube.com/watch?v=${videoId}`;
						try {
							const streamTitle = vid.title || "Unknown";
							const uploaderName = vid.uploader || "Unknown";
							const durationSec = vid.duration || 0;
							const uploadDateTs = vid.uploadDate ? new Date(vid.uploadDate).getTime() / 1000 : null;
							const thumbnailUrl = vid.thumbnailUrl || null;

							insertStreamIgnore(db, {
								service_id: SERVICE_ID_YOUTUBE,
								url: vidUrl,
								title: streamTitle,
								stream_type: "VIDEO_STREAM",
								duration: durationSec,
								uploader: uploaderName,
								upload_date: uploadDateTs === null ? null : Math.floor(uploadDateTs),
								thumbnail_url: thumbnailUrl
							});
							const streamId = findStreamIdByServiceUrl(db, SERVICE_ID_YOUTUBE, vidUrl);
							if (streamId !== undefined) {
								const currentIndex = joinIndex;
								insertPlaylistJoin(db, { playlist_id: plId, stream_id: streamId, join_index: joinIndex++ });
								// if this is the first video in the playlist, set it as the thumbnail_stream_id
								if (currentIndex === 0) {
									try {
										updatePlaylistThumbnail(db, plId, streamId);
									} catch (e: any) {
										log(`WARN: failed to set playlist thumbnail for ${plName}: ${e.message || e.toString()}`, 'warn');
									}
								}
							} else {
								log(`Warning: Could not find/insert stream for video ${streamTitle}`, "warn");
							}
						} catch (videoError: any) {
							log(`ERROR processing video "${vid.title}" in playlist "${plName}": ${videoError.message || videoError.toString()}`, "err");
						}
					}
					plCount++;
				} catch (playlistError: any) {
					log(`FATAL ERROR processing playlist "${plName}": ${playlistError.message || playlistError.toString()}`, "err");
					throw playlistError;
				}
			}
		}
		log(`Processed ${plCount} local playlists.`);
	} catch (e: any) {
		log(`FATAL ERROR during Local Playlists phase: ${e.message || e.toString()}`, "err");
		throw e;
	}

	// --- Remote Playlists (Bookmarks) ---
	try {
		log("Processing Remote Playlist Bookmarks...");
		let rplCount = 0;

		if (ltData.playlistBookmarks && !skipPlaylistImport) {
			const bookmarks: LibreTubePlaylistBookmark[] = ltData.playlistBookmarks;
			for (const rb of bookmarks) {
				try {
					const url = rb.url || (rb.playlistId ? `https://www.youtube.com/playlist?list=${rb.playlistId}` : null);
					if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
						log(`Dropped non-YouTube remote playlist: ${rb.playlistName || 'Untitled'}`, "warn");
						continue;
					}

					const playlistName = rb.playlistName || rb.name || "Untitled";
					const thumbnailUrl = rb.thumbnailUrl || null;
					const uploader = rb.uploader || "Unknown";
					const streamCount = typeof rb.videos === 'number' ? rb.videos : 0;

					// handle duplicate remote playlists according to precedence
					try {
						const existingId = findRemotePlaylistIdByUrlOrName(db, url, playlistName);
						if (existingId !== undefined) {
							if (pb === 'merge_np_precedence') {
								// NewPipe precedence: keep existing remote playlist, skip importing this one
								continue;
							} else if (pb === 'merge_lt_precedence') {
								// LibreTube precedence: remove existing and replace
								deleteRemotePlaylist(db, existingId);
							}
						}
					} catch {
						// proceed to insert if duplicate-check fails
					}

					insertRemotePlaylist(db, {
						service_id: SERVICE_ID_YOUTUBE,
						name: playlistName,
						url,
						thumbnail_url: thumbnailUrl,
						uploader,
						display_index: rplCount++,
						stream_count: streamCount
					});
				} catch (e: any) {
					log(`ERROR inserting remote playlist ${rb.playlistName || 'Untitled'}: ${e.message || e.toString()}`, "err");
				}
			}
		}
		log(`Processed ${rplCount} remote playlist bookmarks.`);
	} catch (e: any) {
		log(`FATAL ERROR during Remote Playlists phase: ${e.message || e.toString()}`, "err");
		throw e;
	}

	// --- History (Stream State + Stream History) ---
	try {
		log("Processing Watch History...");
		let histCount = 0;
		let addedCount = 0;
		let duplicateCount = 0;
		const historyArray: LibreTubeHistoryItem[] = ltData.history || ltData.watchHistory || ltData.watch_history || ltData.watch_history_items || [];

		// build a map of watch positions (videoId -> position)
		const watchPosMap = new Map<string, number | string>();
		if (ltData.watchPositions && Array.isArray(ltData.watchPositions)) {
			const watchPositions: LibreTubeWatchPosition[] = ltData.watchPositions;
			for (const p of watchPositions) {
				if (p && p.videoId) {
					watchPosMap.set(String(p.videoId), p.position || 0);
				}
			}
		}

		if (historyArray && historyArray.length > 0) {
			for (const vid of historyArray) {
				try {
					const vidId = vid.videoId || vid.videoIdStr || vid.id || (vid.url ? extractVideoIdFromUrl(vid.url) : '') || '';
					if (!vidId) continue;
					// normalize URL for deduplication: canonical watch URL
					const vidUrl = `https://www.youtube.com/watch?v=${vidId}`;

					const streamTitle = vid.title || vid.name || "Unknown";
					const uploaderName = vid.uploader || vid.uploaderName || "Unknown";
					const durationSec = vid.duration || vid.length || 0;
					const uploadDateTs = vid.uploadDate ? (isNaN(Number(vid.uploadDate)) ? Math.floor(new Date(vid.uploadDate).getTime() / 1000) : Math.floor(Number(vid.uploadDate))) : null;
					const thumbnailUrl = vid.thumbnailUrl || vid.thumbnail || null;

					// progress: prefer LibreTube watchPositions map if available (positions are ms).
					// History entries without an explicit position are completed watches in LibreTube.
					// Store finite duration-based progress: NewPipe considers it finished, and its UI
					// casts progress seconds to int when drawing list/detail progress.
					const mappedPos = watchPosMap.get(vidId);
					const progressTime = historyItemProgressTime(vid, mappedPos);

					// access date: accept ISO or epoch (ms or s); produce milliseconds
					let accessRaw = vid.accessDate || vid.accessedAt || vid.lastWatched || vid.timestamp || vid.date || vid.time;
					let accessDateMs: number;
					if (!accessRaw) {
						accessDateMs = Date.now();
					} else if (typeof accessRaw === 'number') {
						accessDateMs = accessRaw > 1e12 ? Math.floor(accessRaw) : Math.floor(accessRaw * 1000);
					} else {
						const parsed = Date.parse(String(accessRaw));
						accessDateMs = isNaN(parsed) ? Date.now() : parsed;
					}

					const repeatCount = Number(vid.repeatCount || vid.watchCount || vid.playCount || vid.repeat_count || 1);

					// insert stream (if not present)
					insertStreamIgnore(db, {
						service_id: SERVICE_ID_YOUTUBE,
						url: vidUrl,
						title: streamTitle,
						stream_type: "VIDEO_STREAM",
						duration: durationSec,
						uploader: uploaderName,
						upload_date: uploadDateTs === null ? null : Math.floor(uploadDateTs),
						thumbnail_url: thumbnailUrl
					});

					const streamId = findStreamIdByServiceUrl(db, SERVICE_ID_YOUTUBE, vidUrl);
					if (streamId !== undefined) {

						// stream_state: store latest progress (insert/replace)
						try {
							insertStreamState(db, { progress_time: progressTime, stream_id: streamId });
						} catch (e: any) {
							log(`WARN: failed to write stream_state for ${vidId}: ${e.message || e.toString()}`, "warn");
						}

						// stream_history: dedupe by stream_id and access_date within +/-1s (1000ms)
						try {
							if (mode === 'merge') {
								const low = accessDateMs - 1000;
								const high = accessDateMs + 1000;
								const existingHist = selectHistoryNear(db, streamId, low, high);
								if (existingHist.length > 0) {
									// merge into first matched entry
									const existingDate = Number(existingHist[0].access_date);
									const existingRepeat = Number(existingHist[0].repeat_count) || 0;
									const combined = existingRepeat + repeatCount;
									updateStreamHistoryRepeatCount(db, streamId, existingDate, combined);
									duplicateCount++;
								} else {
									insertStreamHistory(db, { stream_id: streamId, access_date: accessDateMs, repeat_count: repeatCount });
									addedCount++;
								}
							} else {
								insertStreamHistory(db, { stream_id: streamId, access_date: accessDateMs, repeat_count: repeatCount });
								addedCount++;
							}
						} catch (e: any) {
							log(`WARN: failed to write stream_history for ${vidId}: ${e.message || e.toString()}`, "warn");
						}

						histCount++;
					}
				} catch (e: any) {
					log(`ERROR processing history item: ${e.message || e.toString()}`, "warn");
				}
			}
		}

		log(`Processed ${histCount} history items (added: ${addedCount}, duplicates merged: ${duplicateCount}).`);
	} catch (e: any) {
		log(`FATAL ERROR during History phase: ${e.message || e.toString()}`, "err");
		throw e;
	}

	// --- Room Master Table ---
	try {
		db.run("INSERT INTO room_master_table (id, identity_hash) VALUES (42, '7591e8039faa74d8c0517dc867af9d3e')");
		log("Inserted room_master_table identity.");
	} catch (e: any) {
		log("Error inserting room_master_table: " + e.message, "warn");
	}

	// --- Finalize Transaction ---
	try {
		log("Committing transaction...");
		db.run("COMMIT");
	} catch (e: any) {
		log(`FATAL ERROR on COMMIT: ${e.message || e.toString()}`, "err");
		throw e;
	}

	// 4. Export
	log("Exporting database...");
	const data = db.export();
	db.close();
	zip.file("newpipe.db", data);

	if (existingPreferences) {
		zip.file("preferences.json", existingPreferences);
		log("Preserved existing preferences.json.");
	} else {
		zip.file("preferences.json", JSON.stringify(DEFAULT_PREFERENCES, null, 2));
		log("Created default preferences.json.");
	}

	if (existingSettings) {
		zip.file("newpipe.settings", existingSettings);
		log("Preserved existing newpipe.settings.");
	}

	zip.file('stream_state_debug.txt', streamStateDebug || 'No stream_state debug information collected.');
	log('Attached stream_state_debug.txt to zip for inspection.', 'schema');
	if (streamStateDebug) {
		const preview = streamStateDebug.split('\n').slice(0, 12).join('\n');
		log('stream_state_debug preview:\n' + preview, 'schema');
	}

	const dataBytes = await zip.generateAsync({ type: "uint8array" });
	log("Done! NewPipe backup exported.", "info");
	return {
		data: dataBytes,
		filename: "newpipe_converted.zip"
	};
}

export async function convertToNewPipe(npFile: File | undefined, ltFile: File, mode: string, SQL: SqlJsStatic, playlistBehavior?: string) {
	const result = await exportToNewPipe(npFile, ltFile, mode, SQL, playlistBehavior);
	const blob = new Blob([result.data as any], { type: "application/zip" });
	const timestamp = getTimestamp();
	downloadFile(blob, result.filename, timestamp);
	log("Done! File downloaded.", "info");
}

import JSZip from 'jszip';
import type { Database, SqlJsStatic } from 'sql.js';
import { DEFAULT_PREFERENCES, SERVICE_ID_YOUTUBE } from '../../constants';
import { log } from '../../logger';
import { createSchema, ensureStreamStateSchema, collectStreamStateDebug } from '../../sqlHelper';
import type { LibreTubeBackup, LibreTubeHistoryItem, LibreTubeLocalPlaylist, LibreTubePlaylistBookmark, LibreTubeWatchPosition } from '../../types/libretube';
import { downloadFile, extractVideoIdFromUrl, getTimestamp } from '../../utils';

export async function convertToNewPipe(npFile: File | undefined, ltFile: File, mode: string, SQL: SqlJsStatic, playlistBehavior?: string) {
	log("Starting conversion to NewPipe format...");

	let db: Database;
	let zip = new JSZip();
	let streamStateDebug = '';
	let existingPreferences: string | null = null;
	let existingSettings: Blob | null = null;
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
			existingSettings = await settingsFile.async("blob");
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
	const ltData = JSON.parse(ltText) as LibreTubeBackup;

	db.run("BEGIN TRANSACTION");

	// --- Subscriptions ---
	try {
		log("Processing Subscriptions...");
		if (mode === 'merge') {
			db.run(`DELETE FROM subscriptions WHERE service_id = ${SERVICE_ID_YOUTUBE}`);
		}

		let subCount = 0;
		if (ltData.subscriptions) {
			const stmt = db.prepare("INSERT INTO subscriptions (service_id, url, name, avatar_url, subscriber_count, description, notification_mode) VALUES (?, ?, ?, ?, ?, ?, ?)");
			ltData.subscriptions.forEach(sub => {
				try {
					const url = sub.url || `https://www.youtube.com/channel/${sub.channelId}`;
					const name = sub.name || "Unknown";
					const avatarUrl = sub.avatar || sub.avatarUrl || null;
					if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
						log(`Dropped non-YouTube subscription: ${name} (${url})`, "warn");
						return;
					}

					stmt.run([
						SERVICE_ID_YOUTUBE,
						url,
						name,
						avatarUrl,
						0,
						"",
						0
					]);
					subCount++;
				} catch (e: any) {
					log(`ERROR inserting subscription ${sub.name}: ${e.message || e.toString()}`, "err");
				}
			});
			stmt.free();
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
			const streamInsert = db.prepare("INSERT OR IGNORE INTO streams (service_id, url, title, stream_type, duration, uploader, upload_date, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
			const playlistInsert = db.prepare("INSERT INTO playlists (name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?)");
			const joinInsert = db.prepare("INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)");

			const localPlaylists: LibreTubeLocalPlaylist[] = ltData.localPlaylists;
			for (const lp of localPlaylists) {
				const plName = lp.playlist.name || "Untitled";
				try {
					const tempRes = db.exec(`SELECT uid FROM playlists WHERE name = '${plName.replace(/'/g, "''")}'`);
					if (tempRes.length > 0) {
						// Duplicate exists in target: respect precedence
						if (pb === 'merge_lt_precedence') {
							const existingId = tempRes[0].values[0][0];
							try {
								db.run(`DELETE FROM playlist_stream_join WHERE playlist_id = ${existingId}`);
								db.run(`DELETE FROM playlists WHERE uid = ${existingId}`);
								log(`Replaced existing local playlist: ${plName}`, "schema");
							} catch (e: any) {
								log(`WARN: failed to replace playlist ${plName}: ${e.message || e.toString()}`, "warn");
							}
						} else {
							log(`Skipping duplicate local playlist: ${plName}`, "warn");
							continue;
						}
					}

					playlistInsert.run([plName, 0, -1, plCount]);
					const plIdResult = db.exec("SELECT last_insert_rowid()");
					const plId = plIdResult[0].values[0][0];

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

							streamInsert.run([
								SERVICE_ID_YOUTUBE,
								vidUrl,
								streamTitle,
								"VIDEO_STREAM",
								durationSec,
								uploaderName,
								uploadDateTs,
								thumbnailUrl
							]);
							const streamIdRes = db.exec(`SELECT uid FROM streams WHERE service_id=${SERVICE_ID_YOUTUBE} AND url='${vidUrl.replace(/'/g, "''")}'`);
							if (streamIdRes.length > 0 && streamIdRes[0].values.length > 0) {
								const streamId = streamIdRes[0].values[0][0];
								const currentIndex = joinIndex;
								joinInsert.run([plId, streamId, joinIndex++]);
								// if this is the first video in the playlist, set it as the thumbnail_stream_id
								if (currentIndex === 0) {
									try {
										db.run(`UPDATE playlists SET thumbnail_stream_id = ${streamId} WHERE uid = ${plId}`);
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
			streamInsert.free();
			playlistInsert.free();
			joinInsert.free();
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
		const stmt = db.prepare("INSERT INTO remote_playlists (service_id, name, url, thumbnail_url, uploader, display_index, stream_count) VALUES (?, ?, ?, ?, ?, ?, ?)");

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
						const existing = db.exec(`SELECT uid FROM remote_playlists WHERE url = '${url.replace(/'/g, "''")}' OR name = '${playlistName.replace(/'/g, "''")}'`);
						if (existing && existing.length > 0 && existing[0].values.length > 0) {
							if (pb === 'merge_np_precedence') {
								// NewPipe precedence: keep existing remote playlist, skip importing this one
								continue;
							} else if (pb === 'merge_lt_precedence') {
								// LibreTube precedence: remove existing and replace
								const existingId = existing[0].values[0][0];
								db.run(`DELETE FROM remote_playlists WHERE uid = ${existingId}`);
							}
						}
					} catch {
						// proceed to insert if duplicate-check fails
					}

					stmt.run([
						SERVICE_ID_YOUTUBE,
						playlistName,
						url,
						thumbnailUrl,
						uploader,
						rplCount++,
						streamCount
					]);
				} catch (e: any) {
					log(`ERROR inserting remote playlist ${rb.playlistName || 'Untitled'}: ${e.message || e.toString()}`, "err");
				}
			}
			stmt.free();
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
		const watchPosMap = new Map<string, number>();
		if (ltData.watchPositions && Array.isArray(ltData.watchPositions)) {
			const watchPositions: LibreTubeWatchPosition[] = ltData.watchPositions;
			for (const p of watchPositions) {
				if (p && p.videoId) {
					const pos = Number(p.position || 0);
					watchPosMap.set(String(p.videoId), pos);
				}
			}
		}

		if (historyArray && historyArray.length > 0) {
			const streamInsert = db.prepare("INSERT OR IGNORE INTO streams (service_id, url, title, stream_type, duration, uploader, upload_date, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
			const stateInsert = db.prepare("INSERT OR REPLACE INTO stream_state (progress_time, stream_id) VALUES (?, ?)");
			const historyInsert = db.prepare("INSERT OR REPLACE INTO stream_history (stream_id, access_date, repeat_count) VALUES (?, ?, ?)");

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

					// progress: prefer LibreTube watchPositions map if available (positions are ms),
					// fallback to vid.currentTime/position (assumed seconds) and convert to ms.
					let progressTime = 0;
					const mappedPos = watchPosMap.get(vidId);
					const SENTINEL_STR = '9223372036854775807';
					if (mappedPos !== undefined && mappedPos !== null) {
						// ignore sentinel huge values used to indicate unknown/very large position
						if (String(mappedPos) === SENTINEL_STR) {
							progressTime = 0;
						} else {
							progressTime = Math.floor(Number(mappedPos) || 0);
						}
					} else {
						const progressSeconds = vid.currentTime || vid.position || vid.progress || 0;
						progressTime = Math.floor(Number(progressSeconds || 0) * 1000);
					}

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
					streamInsert.run([
						SERVICE_ID_YOUTUBE,
						vidUrl,
						streamTitle,
						"VIDEO_STREAM",
						durationSec,
						uploaderName,
						uploadDateTs,
						thumbnailUrl
					]);

					const streamIdRes = db.exec(`SELECT uid FROM streams WHERE service_id=${SERVICE_ID_YOUTUBE} AND url='${vidUrl.replace(/'/g, "''")}'`);
					if (streamIdRes.length > 0 && streamIdRes[0].values.length > 0) {
						const streamId = streamIdRes[0].values[0][0];

						// stream_state: store latest progress (insert/replace)
						try {
							stateInsert.run([progressTime, streamId]);
						} catch (e: any) {
							log(`WARN: failed to write stream_state for ${vidId}: ${e.message || e.toString()}`, "warn");
						}

						// stream_history: dedupe by stream_id and access_date within +/-1s (1000ms)
						try {
							if (mode === 'merge') {
								const low = accessDateMs - 1000;
								const high = accessDateMs + 1000;
								const existing = db.exec(`SELECT access_date, repeat_count FROM stream_history WHERE stream_id = ${streamId} AND access_date BETWEEN ${low} AND ${high}`);
								if (existing && existing.length > 0 && existing[0].values.length > 0) {
									// merge into first matched entry
									const existingDate = Number(existing[0].values[0][0]);
									const existingRepeat = Number(existing[0].values[0][1]) || 0;
									const combined = existingRepeat + repeatCount;
									db.run(`UPDATE stream_history SET repeat_count = ${combined} WHERE stream_id = ${streamId} AND access_date = ${existingDate}`);
									duplicateCount++;
								} else {
									historyInsert.run([streamId, accessDateMs, repeatCount]);
									addedCount++;
								}
							} else {
								historyInsert.run([streamId, accessDateMs, repeatCount]);
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

			streamInsert.free();
			stateInsert.free();
			historyInsert.free();
		}

		log(`Processed ${histCount} history items (added: ${addedCount}, duplicates merged: ${duplicateCount}).`);
	} catch (e: any) {
		log(`Error processing history: ${e.message}`, "err");
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

	const blob = await zip.generateAsync({ type: "blob" });
	const timestamp = getTimestamp();
	downloadFile(blob, "newpipe_converted.zip", timestamp);
	log("Done! File downloaded.", "info");
}

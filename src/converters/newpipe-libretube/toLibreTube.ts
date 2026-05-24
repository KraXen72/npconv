import JSZip from 'jszip';
import type { SqlJsStatic } from 'sql.js';
import { log } from '../../logger';
import { collectStreamStateDebug } from '../../sqlHelper';
import type { LibreTubeBackup, LibreTubeHistoryItem, LibreTubeLocalPlaylist, LibreTubePlaylistBookmark, LibreTubeVideo } from '../../schemas/libretube';
import { clampToSafeInt, downloadFile, extractVideoIdFromUrl, formatUploadDate, getTimestamp, parseAccessDateToMs } from '../../utils';
import { parseJsonWithSchema, parseWithSchema } from '../../schemas/sql';
import { LibreTubeBackupSchema } from '../../schemas/libretube';
import {
	selectPlaylists,
	selectPlaylistVideos,
	selectYoutubeHistory,
	selectYoutubeRemotePlaylists,
	selectYoutubeStreamStates,
	selectYoutubeSubscriptions
} from '../../db/newpipeRepo';

export interface LibreTubeExportResult {
	jsonText: string;
	filename: string;
}

export async function exportToLibreTube(npFile: File, ltFile: File | undefined, mode: string, SQL: SqlJsStatic, playlistBehavior?: string, includeWatchHistoryParam?: boolean): Promise<LibreTubeExportResult> {
	log("Starting conversion to LibreTube format...");

	let targetData: LibreTubeBackup = {
		watchHistory: [],
		subscriptions: [],
		playlistBookmarks: [],
		localPlaylists: [],
		preferences: [],
		watchPositions: []
	};
	// playlist behavior handling
	const pb = playlistBehavior || null;
	let skipImportPlaylists = false;
	// when merging and preserving LibreTube playlists, keep a snapshot to restore
	let preservedPlaylists: Partial<LibreTubeBackup> | undefined = undefined;
	if (mode === 'merge' && ltFile) {
		log("Reading target LibreTube file...");
		const text = await ltFile.text();
		const parsed = parseJsonWithSchema(LibreTubeBackupSchema, text, 'LibreTube merge target backup');
		targetData = parsed;
		// take a deep copy of playlist-related keys so we can fully restore them
		// if the user chooses to keep only LibreTube playlists
		preservedPlaylists = {
			playlistBookmarks: Array.isArray(parsed.playlistBookmarks) ? JSON.parse(JSON.stringify(parsed.playlistBookmarks)) : parsed.playlistBookmarks,
			localPlaylists: Array.isArray(parsed.localPlaylists) ? JSON.parse(JSON.stringify(parsed.localPlaylists)) : parsed.localPlaylists,
			otherPlaylistKeys: {}
		};
		Object.keys(parsed).forEach(k => {
			if (k !== 'playlistBookmarks' && k !== 'localPlaylists' && /playlist/i.test(k)) {
				try {
					if (!preservedPlaylists!.otherPlaylistKeys) preservedPlaylists!.otherPlaylistKeys = {};
					preservedPlaylists!.otherPlaylistKeys[k] = JSON.parse(JSON.stringify((parsed as any)[k]));
				} catch {
					if (!preservedPlaylists!.otherPlaylistKeys) preservedPlaylists!.otherPlaylistKeys = {};
					preservedPlaylists!.otherPlaylistKeys[k] = (parsed as any)[k];
				}
			}
		});

		// Decide how to treat existing playlists based on behavior
		if (pb === 'only_newpipe') {
			targetData.subscriptions = [];
			targetData.playlistBookmarks = [];
			targetData.localPlaylists = [];
			log("Cleared target LibreTube playlists; will import only NewPipe playlists.");
		} else if (pb === 'only_libretube') {
			// preserve existing LibreTube playlists and skip importing from NewPipe
			skipImportPlaylists = true;
			log("Preserving existing LibreTube playlists; will skip importing NewPipe playlists.");
		} else {
			// merge modes: keep existing target lists and perform per-playlist precedence handling later
			targetData.subscriptions = targetData.subscriptions || [];
			targetData.playlistBookmarks = targetData.playlistBookmarks || [];
			targetData.localPlaylists = targetData.localPlaylists || [];
			log(`Merging playlists with behavior: ${pb || 'default (LibreTube precedence)'}`);
		}
	}

	log("Reading NewPipe backup...");
	const npData = await npFile.arrayBuffer();
	const npZip = await JSZip.loadAsync(npData as any);
	const dbFile = npZip.file("newpipe.db");
	if (!dbFile) throw new Error("NewPipe ZIP must contain newpipe.db");
	const dbData = await dbFile.async("uint8array");
	const db = new SQL.Database(dbData);
	log("NewPipe database loaded.");

	try {
		try {
			const streamStateDebugInput = collectStreamStateDebug(db);
			// Log the full, nicely formatted stream_state debug information to the debug console
			// (do not download a separate debug file when converting NewPipe -> LibreTube)
			log('Stream state debug (input NewPipe DB):\n' + (streamStateDebugInput || 'No stream_state debug info collected.'), 'schema');
		} catch (e: any) {
			log('Failed to collect input stream_state debug: ' + (e.message || e.toString()), 'warn');
		}

	log("Extracting Subscriptions...");
	const subscriptionRows = selectYoutubeSubscriptions(db);
	if (subscriptionRows.length > 0) {
		subscriptionRows.forEach((row) => {
			const url = row.url || '';
			const name = row.name || '';
			if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
				log(`Dropped non-YouTube subscription URL: ${name}`, "warn");
				return;
			}
			let channelId = "";
			const channelMatch = url.match(/channel\/([\w-]+)/);
			const userMatch = url.match(/user\/([\w-]+)/);
			if (channelMatch) channelId = channelMatch[1];
			else if (userMatch) channelId = userMatch[1];

			targetData.subscriptions.push({
				channelId: channelId,
				url: url,
				name,
				avatar: row.avatar_url || undefined,
				verified: false
			});
		});
	}
	log(`Extracted ${targetData.subscriptions.length} YouTube subscriptions.`);

	log("Extracting Remote Playlists...");
	const remotePlaylistRows = selectYoutubeRemotePlaylists(db);
	if (remotePlaylistRows.length > 0 && !skipImportPlaylists) {
		remotePlaylistRows.forEach((row) => {
			const url = row.url || '';
			const name = row.name || '';
			if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
				log(`Dropped non-YouTube remote playlist URL: ${name}`, "warn");
				return;
			}
			const idMatch = url.match(/[?&]list=([^&]+)/);
			const id = idMatch ? idMatch[1] : "";

			targetData.playlistBookmarks.push({
				playlistId: id,
				playlistName: name,
				thumbnailUrl: row.thumbnail_url || undefined,
				uploader: row.uploader || undefined,
				uploaderUrl: "",
				videos: clampToSafeInt(row.stream_count)
			});
		});
	}
	log(`Extracted ${targetData.playlistBookmarks.length} remote playlist bookmarks.`);

	log("Extracting Local Playlists...");
	const playlists = selectPlaylists(db);
	if (playlists.length > 0 && !skipImportPlaylists) {
		for (const playlist of playlists) {
			const plId = playlist.uid;
			const plName = playlist.name || '';
			const videos: LibreTubeVideo[] = [];
			let itemIndex = 0; // numeric id for each playlist item to satisfy Kotlin Int deserializer
			// TODO: batch playlist video loading during the Drizzle migration.
			const playlistVideos = selectPlaylistVideos(db, plId);

			if (playlistVideos.length > 0) {
				playlistVideos.forEach((v) => {
					const vUrl = v.url;
					const vidId = extractVideoIdFromUrl(vUrl);
					if (!vidId) {
						log(`Warning: Skipped stream in playlist "${plName}" due to unparseable URL: ${vUrl}`, "warn");
						return;
					}

					videos.push({
						id: itemIndex++,
						playlistId: clampToSafeInt(plId),
						videoId: vidId,
						title: v.title,
						uploadDate: formatUploadDate(v.upload_date),
						uploader: v.uploader,
						thumbnailUrl: v.thumbnail_url || undefined,
						duration: clampToSafeInt(v.duration)
					});
				});
			}

			if (videos.length > 0 || plName) {
				// handle precedence: if a playlist with the same name exists in targetData,
				// either replace it (NewPipe precedence) or skip (LibreTube precedence)
				const existingIndex = targetData.localPlaylists.findIndex(p => p.playlist && p.playlist.name === plName);
				if (existingIndex >= 0) {
					if (pb === 'merge_np_precedence') {
						// NewPipe/source precedence: replace existing target playlist
						targetData.localPlaylists.splice(existingIndex, 1);
					} else {
						// LibreTube precedence (or default): keep existing target playlist, skip adding
						continue;
					}
				}

				targetData.localPlaylists.push({
					playlist: {
						id: clampToSafeInt(plId),
						name: plName,
						thumbnailUrl: videos.length > 0 ? videos[0].thumbnailUrl : ""
					},
					videos: videos
				});
			}
		}
	}
	log(`Extracted ${targetData.localPlaylists.length} local playlists.`);

	// If the user explicitly requested to preserve only the LibreTube playlists,
	// restore the exact playlist structures we saved earlier to avoid any
	// accidental additions or modifications coming from the NewPipe DB.
	if (mode === 'merge' && playlistBehavior === 'only_libretube' && preservedPlaylists) {
		try {
			targetData.playlistBookmarks = preservedPlaylists.playlistBookmarks as LibreTubePlaylistBookmark[];
			targetData.localPlaylists = preservedPlaylists.localPlaylists as LibreTubeLocalPlaylist[];
			Object.keys(preservedPlaylists.otherPlaylistKeys || {}).forEach(k => {
				(targetData as any)[k] = preservedPlaylists.otherPlaylistKeys[k];
			});
			log('Restored original LibreTube playlist data (only_libretube).');
		} catch (e: any) {
			log('Failed to restore preserved LibreTube playlists: ' + (e.message || e.toString()), 'warn');
		}
	}

	// Sanitize potentially oversized numeric values (e.g. positions) to avoid
	// Kotlin Long overflow when LibreTube decodes the JSON. Clamp to
	if (targetData && Array.isArray(targetData.watchPositions)) {
		targetData.watchPositions = targetData.watchPositions.map(wp => {
			if (wp && wp.position !== undefined && wp.position !== null) {
				return { ...wp, position: clampToSafeInt(wp.position) };
			}
			return wp;
		});
	}

	// --- Import watch history & positions from NewPipe DB if requested ---
	const includeWatchHistory = includeWatchHistoryParam === undefined ? true : Boolean(includeWatchHistoryParam);
	// If merging and the user explicitly disabled includeWatchHistory, preserve targetData as-is
	if (includeWatchHistory) {
		try {
			// Select stream metadata so we can build full LibreTube-style watchHistory entries
			const historyRows = selectYoutubeHistory(db);
			const stateRows = selectYoutubeStreamStates(db);

			// Ensure arrays exist
			targetData.watchHistory = targetData.watchHistory || [];
			targetData.watchPositions = targetData.watchPositions || [];

			// Build maps for merging
			const posMap = new Map<string, number>();
			for (const wp of targetData.watchPositions) {
				if (wp && wp.videoId) posMap.set(String(wp.videoId), clampToSafeInt(wp.position));
			}

			// Merge stream_state -> watchPositions (progress_time assumed milliseconds)
			if (stateRows.length > 0) {
				for (const r of stateRows) {
					const url = r.url;
					const progressRaw = r.progress_time || 0;
					const progressNum = Number(progressRaw);
					const vid = extractVideoIdFromUrl(url);
					if (!vid) continue;
					const existing = posMap.get(vid) || 0;
					// clamp progress to safe numeric range to avoid Numeric overflow
					// when LibreTube (Kotlin) parses the produced JSON
					const progressClamped = clampToSafeInt(progressNum);
					// keep the maximum known progress
					if (progressClamped > existing) posMap.set(vid, progressClamped);
				}
			}

			// Rebuild targetData.watchPositions from map
			targetData.watchPositions = Array.from(posMap.entries()).map(([videoId, position]) => ({ videoId, position }));

			// Merge stream_history -> watchHistory
			if (historyRows.length > 0) {
				// Normalize existing history into a list and map keyed by videoId so we can merge metadata
				const existingHistory: LibreTubeHistoryItem[] = Array.isArray(targetData.watchHistory) ? targetData.watchHistory.map((e: LibreTubeHistoryItem) => ({
					...e,
					accessDate: parseAccessDateToMs((e && (e.accessDate || e.accessedAt || e.lastWatched || e.timestamp || e.date || e.time)) || 0)
				})) : [];
				const existingMap = new Map<string, LibreTubeHistoryItem>();
				for (const e of existingHistory) if (e && e.videoId) existingMap.set(String(e.videoId), e);

				for (const r of historyRows) {
					const url = r.url;
					const title = r.title || '';
					const duration = clampToSafeInt(r.duration);
					const uploader = r.uploader || '';
					const uploaderUrlRaw = r.uploader_url || '';
					const thumbnail = r.thumbnail_url || '';
					const uploadDateRaw = r.upload_date;
					const accessDateRaw = r.access_date;
					const vid = extractVideoIdFromUrl(url);
					if (!vid) continue;

					// derive uploaderId from uploader_url when possible (channel/user id)
					let uploaderId = '';
					try {
						const mChan = String(uploaderUrlRaw).match(/channel\/([\w-]+)/);
						const mUser = String(uploaderUrlRaw).match(/user\/([\w-]+)/);
						if (mChan) uploaderId = mChan[1];
						else if (mUser) uploaderId = mUser[1];
						else if (/^[UC][A-Za-z0-9_-]{20,}$/.test(uploaderUrlRaw)) uploaderId = uploaderUrlRaw; // maybe already an id
					} catch {
						uploaderId = '';
					}

					// format upload date (upload_date stored as seconds in DB)
					const uploadDate = formatUploadDate(uploadDateRaw);

					// If we already have an entry for this video, skip (prefer existing). Otherwise add full metadata entry.
					if (existingMap.has(vid)) continue;

					const accessMs = parseAccessDateToMs(accessDateRaw);

					existingHistory.push({
						videoId: vid,
						title: title,
						uploadDate: uploadDate,
						uploader: uploader,
						uploaderUrl: uploaderId,
						uploaderAvatar: "",
						thumbnailUrl: thumbnail,
						duration: duration,
						accessDate: accessMs
					});
				}

				// Sort watch history by access date descending (most recent first)
				existingHistory.sort((a, b) => (Number(b && b.accessDate ? b.accessDate : 0)) - (Number(a && a.accessDate ? a.accessDate : 0)));

				targetData.watchHistory = existingHistory;
			}
		} catch (e: any) {
			log('Failed to import watch history from NewPipe DB: ' + (e.message || e.toString()), 'warn');
		}
	}

	const validatedTarget = parseWithSchema(LibreTubeBackupSchema, targetData, 'Generated LibreTube backup');
	const jsonStr = JSON.stringify(validatedTarget, null, 2);
	log("Done! LibreTube backup exported.", "info");
	return {
		jsonText: jsonStr,
		filename: "libretube_converted.json"
	};
} finally {
	db.close();
	log("NewPipe database closed.", "info");
}
}

export async function convertToLibreTube(npFile: File, ltFile: File | undefined, mode: string, SQL: SqlJsStatic, playlistBehavior?: string, includeWatchHistoryParam?: boolean) {
	const result = await exportToLibreTube(npFile, ltFile, mode, SQL, playlistBehavior, includeWatchHistoryParam);
	const blob = new Blob([result.jsonText], { type: "application/json" });
	const timestamp = getTimestamp();
	downloadFile(blob, result.filename, timestamp);
	log("Done! File downloaded.", "info");
}

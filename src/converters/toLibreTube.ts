import { SERVICE_ID_YOUTUBE } from '../constants';
import { log } from '../logger';
import { getTimestamp, downloadFile } from '../utils';
import JSZip from 'jszip';

// Clamp numeric values to JS safe integer range so Kotlin Long deserialization
// won't fail when LibreTube parses the exported JSON.
const MAX_SAFE_NUM = Number.MAX_SAFE_INTEGER; // 9007199254740991
function clampToSafeInt(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || isNaN(n)) return 0;
  if (n > MAX_SAFE_NUM) return MAX_SAFE_NUM;
  if (n < -MAX_SAFE_NUM) return -MAX_SAFE_NUM;
  return Math.trunc(n);
}

// Robust upload date formatter. Handles seconds, milliseconds, YYYYMMDD, and ISO-like strings.
function formatUploadDate(raw: unknown): string {
  if (!raw && raw !== 0) return "1970-01-01";
  const s = String(raw).trim();
  // Already ISO-like date string
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
  const n = Number(s);
  if (!Number.isFinite(n)) return "1970-01-01";
  const abs = Math.abs(n);
  // YYYYMMDD (e.g. 20230424)
  if (abs >= 10000000 && abs <= 99999999) {
    const str = String(Math.trunc(n));
    const y = str.slice(0, 4);
    const m = str.slice(4, 6);
    const d = str.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  // Milliseconds timestamp (13+ digits)
  if (abs > 1e12) return new Date(n).toISOString().split('T')[0];
  // Seconds timestamp (10 digits)
  if (abs >= 1e9) return new Date(n * 1000).toISOString().split('T')[0];
  // Fallback: treat as milliseconds
  return new Date(n).toISOString().split('T')[0];
}

// Parse various access date fields into milliseconds since epoch.
function parseAccessDateToMs(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number') {
    // If already milliseconds (large), keep; if seconds, convert to ms
    return raw > 1e12 ? Math.floor(raw) : Math.floor(raw * 1000);
  }
  const s = String(raw).trim();
  if (!s) return 0;
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return parsed;
  // fallback numeric parse
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

export async function convertToLibreTube(npFile: File | undefined, ltFile: File | undefined, mode: string, SQL: any, playlistBehavior?: string, includeWatchHistoryParam?: boolean) {
  log("Starting conversion to LibreTube format...");
  
  let targetData: any = {
    watchHistory: [],
    subscriptions: [],
    playlistBookmarks: [],
    localPlaylists: [],
    preferences: [] 
  };
  // playlist behavior handling
  const pb = playlistBehavior || null;
  let skipImportPlaylists = false;
  if (mode === 'merge' && ltFile) {
    log("Reading target LibreTube file...");
    const text = await ltFile.text();
    targetData = JSON.parse(text);
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
      log(`Merging playlists with behavior: ${pb || 'default (NewPipe precedence)'}`);
    }
  }

  log("Reading NewPipe backup...");
  const npData = await npFile!.arrayBuffer();
  const npZip = await JSZip.loadAsync(npData as any);
  const dbFile = npZip.file("newpipe.db");
  if (!dbFile) throw new Error("NewPipe ZIP must contain newpipe.db");
  const dbData = await dbFile.async("uint8array");
  const db = new SQL.Database(dbData);
  log("NewPipe database loaded.");

  try {
    let streamStateDebugInput = '';
    const ti = db.exec("PRAGMA table_info('stream_state')") || [];
    const fk = db.exec("PRAGMA foreign_key_list('stream_state')") || [];
    const create = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='stream_state'") || [];
    streamStateDebugInput += 'PRAGMA table_info("stream_state"):\n';
    if (ti.length > 0) streamStateDebugInput += JSON.stringify(ti[0], null, 2) + '\n';
    streamStateDebugInput += '\nPRAGMA foreign_key_list("stream_state"):\n';
    if (fk.length > 0) streamStateDebugInput += JSON.stringify(fk[0], null, 2) + '\n';
    streamStateDebugInput += '\nCREATE statement:\n';
    if (create.length > 0 && create[0].values && create[0].values.length > 0) streamStateDebugInput += create[0].values[0][0] + '\n';

    // Log the full, nicely formatted stream_state debug information to the debug console
    // (do not download a separate debug file when converting NewPipe -> LibreTube)
    log('Stream state debug (input NewPipe DB):\n' + (streamStateDebugInput || 'No stream_state debug info collected.'), 'schema');
  } catch (e: any) {
    log('Failed to collect input stream_state debug: ' + (e.message || e.toString()), 'warn');
  }

  log("Extracting Subscriptions...");
  const subsRes = db.exec(`SELECT url, name, avatar_url FROM subscriptions WHERE service_id = ${SERVICE_ID_YOUTUBE}`);
  if (subsRes.length > 0) {
    const rows = subsRes[0].values;
    rows.forEach((row: any) => {
      const url = row[0];
      if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
        log(`Dropped non-YouTube subscription URL: ${row[1]}`, "warn");
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
        name: row[1],
        avatar: row[2],
        verified: false
      });
    });
  }
  log(`Extracted ${targetData.subscriptions.length} YouTube subscriptions.`);

  log("Extracting Remote Playlists...");
  const remPlRes = db.exec(`SELECT name, url, uploader, thumbnail_url, stream_count FROM remote_playlists WHERE service_id = ${SERVICE_ID_YOUTUBE}`);
  if (remPlRes.length > 0 && !skipImportPlaylists) {
    const rows = remPlRes[0].values;
    rows.forEach((row: any) => {
      const url = row[1];
      if (!url || (!url.includes("youtube.com") && !url.includes("youtu.be"))) {
        log(`Dropped non-YouTube remote playlist URL: ${row[0]}`, "warn");
        return;
      }
      const idMatch = url.match(/[?&]list=([^&]+)/);
      const id = idMatch ? idMatch[1] : "";

      targetData.playlistBookmarks.push({
        playlistId: id,
        playlistName: row[0],
        thumbnailUrl: row[3],
        uploader: row[2],
        uploaderUrl: "",
        videos: clampToSafeInt(row[4])
      });
    });
  }
  log(`Extracted ${targetData.playlistBookmarks.length} remote playlist bookmarks.`);

  log("Extracting Local Playlists...");
  const playlistsRes = db.exec("SELECT uid, name FROM playlists");
  if (playlistsRes.length > 0 && !skipImportPlaylists) {
    for (const plRow of playlistsRes[0].values) {
      const plId = plRow[0];
      const plName = plRow[1];
      const videos: any[] = [];
      let itemIndex = 0; // numeric id for each playlist item to satisfy Kotlin Int deserializer
      const vidRes = db.exec(`
                    SELECT s.url, s.title, s.duration, s.uploader, s.upload_date, s.thumbnail_url
                    FROM playlist_stream_join j
                    JOIN streams s ON j.stream_id = s.uid
                    WHERE j.playlist_id = ${plId} AND s.service_id = ${SERVICE_ID_YOUTUBE}
                    ORDER BY j.join_index ASC
                `);

      if (vidRes.length > 0) {
        vidRes[0].values.forEach((v: any) => {
          const vUrl = v[0];
          const vidIdMatch = vUrl.match(/v=([^&]+)/);
          const vidId = vidIdMatch ? vidIdMatch[1] : "";
          if (!vidId) {
            log(`Warning: Skipped stream in playlist "${plName}" due to unparseable URL: ${vUrl}`, "warn");
            return;
          }

          videos.push({
            id: itemIndex++,
            playlistId: clampToSafeInt(plId),
            videoId: vidId,
            title: v[1],
            uploadDate: formatUploadDate(v[4]),
            uploader: v[3],
            thumbnailUrl: v[5],
            duration: clampToSafeInt(v[2])
          });
        });
      }

      if (videos.length > 0 || plName) {
        // handle precedence: if a playlist with the same name exists in targetData,
        // either replace it (NewPipe precedence) or skip (LibreTube precedence)
        const existingIndex = targetData.localPlaylists.findIndex((p: any) => p.playlist && p.playlist.name === plName);
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

  // Sanitize potentially oversized numeric values (e.g. positions) to avoid
  // Kotlin Long overflow when LibreTube decodes the JSON. Clamp to
  if (targetData && Array.isArray(targetData.watchPositions)) {
    targetData.watchPositions = targetData.watchPositions.map((wp: any) => {
      if (wp && wp.position !== undefined && wp.position !== null) {
        return { ...wp, position: clampToSafeInt(wp.position) };
      }
      return wp;
    });
  }

  // --- Import watch history & positions from NewPipe DB if requested ---
  const includeWatchHistory = includeWatchHistoryParam === undefined ? true : Boolean(includeWatchHistoryParam);
  // If merging and the user explicitly disabled includeWatchHistory, preserve targetData as-is
  if (includeWatchHistory && npFile) {
    try {
      // Select stream metadata so we can build full LibreTube-style watchHistory entries
      const histRes = db.exec(`SELECT s.url, s.title, s.duration, s.uploader, s.uploader_url, s.thumbnail_url, s.upload_date, sh.access_date, sh.repeat_count FROM stream_history sh JOIN streams s ON sh.stream_id = s.uid WHERE s.service_id = ${SERVICE_ID_YOUTUBE}`) || [];
      const stateRes = db.exec(`SELECT s.url, ss.progress_time FROM stream_state ss JOIN streams s ON ss.stream_id = s.uid WHERE s.service_id = ${SERVICE_ID_YOUTUBE}`) || [];

      // Ensure arrays exist
      targetData.watchHistory = targetData.watchHistory || [];
      targetData.watchPositions = targetData.watchPositions || [];

      // Build maps for merging
      const posMap = new Map<string, number>();
      for (const wp of targetData.watchPositions) {
        if (wp && wp.videoId) posMap.set(String(wp.videoId), clampToSafeInt(wp.position));
      }

      // Merge stream_state -> watchPositions (progress_time assumed milliseconds)
      if (stateRes.length > 0) {
        const rows = stateRes[0].values;
        for (const r of rows) {
            const url = r[0];
            const progressRaw = r[1] || 0;
            const progressNum = Number(progressRaw);
          const idMatch = String(url || '').match(/v=([^&]+)/);
          const vid = idMatch ? idMatch[1] : '';
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
      if (histRes.length > 0) {
        const rows = histRes[0].values;
        // Normalize existing history into a list and map keyed by videoId so we can merge metadata
        const existingHistory: any[] = Array.isArray(targetData.watchHistory) ? targetData.watchHistory.map((e: any) => ({
          ...e,
          accessDate: parseAccessDateToMs((e && (e.accessDate || e.accessedAt || e.lastWatched || e.timestamp || e.date || e.time)) || 0)
        })) : [];
        const existingMap = new Map<string, any>();
        for (const e of existingHistory) if (e && e.videoId) existingMap.set(String(e.videoId), e);

        for (const r of rows) {
          const url = r[0];
          const title = r[1] || '';
          const duration = clampToSafeInt(r[2]);
          const uploader = r[3] || '';
          const uploaderUrlRaw = r[4] || '';
          const thumbnail = r[5] || '';
          const uploadDateRaw = r[6];
          const accessDateRaw = r[7];
          const idMatch = String(url || '').match(/v=([^&]+)/);
          const vid = idMatch ? idMatch[1] : '';
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
        existingHistory.sort((a: any, b: any) => (b && b.accessDate ? b.accessDate : 0) - (a && a.accessDate ? a.accessDate : 0));

        targetData.watchHistory = existingHistory;
      }
    } catch (e: any) {
      log('Failed to import watch history from NewPipe DB: ' + (e.message || e.toString()), 'warn');
    }
  }

  const jsonStr = JSON.stringify(targetData, null, 2);
  const blob = new Blob([jsonStr], {type: "application/json"});
  const timestamp = getTimestamp();
  downloadFile(blob, "libretube_converted.json", timestamp);
  log("Done! File downloaded.", "info");
}


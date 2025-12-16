import { SERVICE_ID_YOUTUBE, DEFAULT_PREFERENCES } from '../constants';
import { log } from '../logger';
import { getTimestamp, downloadFile } from '../utils';
import { createSchema, ensureStreamStateSchema } from '../sqlHelper';
import JSZip from 'jszip';

export async function convertToNewPipe(npFile: File | undefined, ltFile: File, mode: string, SQL: any) {
  log("Starting conversion to NewPipe format...");

  let db: any;
  let zip = new JSZip();
  let streamStateDebug = '';
  let existingPreferences: any = null;
  let existingSettings: any = null;

  // 1. Setup DB
  if (mode === 'merge' && npFile) {
    log("Loading existing NewPipe backup...");
    const npData = await npFile.arrayBuffer();
    const sourceZip = await JSZip.loadAsync(npData as any);

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
        try {
          const ti = db.exec("PRAGMA table_info('stream_state')") || [];
          const fk = db.exec("PRAGMA foreign_key_list('stream_state')") || [];
          const create = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='stream_state'") || [];
          streamStateDebug += 'PRAGMA table_info("stream_state"):\n';
          if (ti.length > 0) streamStateDebug += JSON.stringify(ti[0], null, 2) + '\n';
          streamStateDebug += '\nPRAGMA foreign_key_list("stream_state"):\n';
          if (fk.length > 0) streamStateDebug += JSON.stringify(fk[0], null, 2) + '\n';
          streamStateDebug += '\nCREATE statement:\n';
          if (create.length > 0 && create[0].values && create[0].values.length > 0) streamStateDebug += create[0].values[0][0] + '\n';
        } catch (e: any) {
          streamStateDebug += 'Failed to collect stream_state debug info: ' + (e.message || e.toString()) + '\n';
        }
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
    try {
      const ti = db.exec("PRAGMA table_info('stream_state')") || [];
      const fk = db.exec("PRAGMA foreign_key_list('stream_state')") || [];
      const create = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='stream_state'") || [];
      streamStateDebug += 'PRAGMA table_info("stream_state"):\n';
      if (ti.length > 0) streamStateDebug += JSON.stringify(ti[0], null, 2) + '\n';
      streamStateDebug += '\nPRAGMA foreign_key_list("stream_state"):\n';
      if (fk.length > 0) streamStateDebug += JSON.stringify(fk[0], null, 2) + '\n';
      streamStateDebug += '\nCREATE statement:\n';
      if (create.length > 0 && create[0].values && create[0].values.length > 0) streamStateDebug += create[0].values[0][0] + '\n';
    } catch (e: any) {
      streamStateDebug += 'Failed to collect stream_state debug info (new DB): ' + (e.message || e.toString()) + '\n';
    }
  }

  // 2. Load LibreTube Data
  log("Parsing LibreTube JSON...");
  const ltText = await ltFile.text();
  const ltData = JSON.parse(ltText);

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
      ltData.subscriptions.forEach((sub: any) => {
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
    if (mode === 'merge') {
      db.run("DELETE FROM playlists");
      db.run("DELETE FROM playlist_stream_join");
      db.run("DELETE FROM remote_playlists");
      log("Cleared existing playlists and joins.");
    }

    let plCount = 0;
    if (ltData.localPlaylists) {
      const streamInsert = db.prepare("INSERT OR IGNORE INTO streams (service_id, url, title, stream_type, duration, uploader, upload_date, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const playlistInsert = db.prepare("INSERT INTO playlists (name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, ?, ?, ?)");
      const joinInsert = db.prepare("INSERT INTO playlist_stream_join (playlist_id, stream_id, join_index) VALUES (?, ?, ?)");

      for (const lp of ltData.localPlaylists) {
        const plName = lp.playlist.name || "Untitled";
        try {
          const tempRes = db.exec(`SELECT uid FROM playlists WHERE name = '${plName.replace(/'/g, "''")}'`);
          if (tempRes.length > 0) {
            log(`Skipping duplicate local playlist: ${plName}`, "warn");
            continue;
          }

          playlistInsert.run([plName, 0, -1, plCount]);
          const plIdResult = db.exec("SELECT last_insert_rowid()");
          const plId = plIdResult[0].values[0][0];

          let joinIndex = 0;
          for (const vid of lp.videos) {
            const vidUrl = `https://www.youtube.com/watch?v=${vid.videoId}`;
            if (!vid.videoId) {
              log(`Skipped video in playlist ${plName} due to missing videoId.`, "warn");
              continue;
            }
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
                joinInsert.run([plId, streamId, joinIndex++]);
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

    if (ltData.playlistBookmarks) {
      for (const rb of ltData.playlistBookmarks) {
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
    const historyArray = ltData.history || ltData.watchHistory || ltData.watch_history || ltData.watch_history_items || [];

    if (historyArray && historyArray.length > 0) {
      const streamInsert = db.prepare("INSERT OR IGNORE INTO streams (service_id, url, title, stream_type, duration, uploader, upload_date, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const stateInsert = db.prepare("INSERT OR REPLACE INTO stream_state (progress_time, stream_id) VALUES (?, ?)");
      const historyInsert = db.prepare("INSERT OR REPLACE INTO stream_history (stream_id, access_date, repeat_count) VALUES (?, ?, ?)");

      for (const vid of historyArray) {
        try {
          // Video id may be in several places
          const vidId = vid.videoId || vid.videoIdStr || vid.id || (vid.url && (vid.url.match(/v=([^&]+)/) || [])[1]);
          if (!vidId) continue;
          const vidUrl = `https://www.youtube.com/watch?v=${vidId}`;

          const streamTitle = vid.title || vid.name || "Unknown";
          const uploaderName = vid.uploader || vid.uploaderName || "Unknown";
          const durationSec = vid.duration || vid.length || 0;
          const uploadDateTs = vid.uploadDate ? (isNaN(Number(vid.uploadDate)) ? Math.floor(new Date(vid.uploadDate).getTime() / 1000) : Math.floor(Number(vid.uploadDate))) : null;
          const thumbnailUrl = vid.thumbnailUrl || vid.thumbnail || null;

          // progress: LibreTube tends to store seconds; NewPipe expects milliseconds.
          const progressSeconds = vid.currentTime || vid.position || vid.progress || 0;
          const progressTime = Math.floor(Number(progressSeconds || 0) * 1000);

          // access date: try multiple fields, accept ISO or epoch (ms or s)
          let accessRaw = vid.accessDate || vid.accessedAt || vid.lastWatched || vid.timestamp || vid.date || vid.time;
          let accessDateSec: number;
          if (!accessRaw) {
            accessDateSec = Math.floor(Date.now() / 1000);
          } else if (typeof accessRaw === 'number') {
            // if too large, assume ms
            accessDateSec = accessRaw > 1e12 ? Math.floor(accessRaw / 1000) : Math.floor(accessRaw);
          } else {
            const parsed = Date.parse(String(accessRaw));
            accessDateSec = isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
          }

          const repeatCount = vid.repeatCount || vid.watchCount || vid.playCount || vid.repeat_count || 1;

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

            // stream_history: primary key is (stream_id, access_date). Merge semantics: sum repeat_count for same access_date when merging.
            try {
              if (mode === 'merge') {
                const existing = db.exec(`SELECT repeat_count FROM stream_history WHERE stream_id = ${streamId} AND access_date = ${accessDateSec}`);
                if (existing && existing.length > 0 && existing[0].values.length > 0) {
                  const old = Number(existing[0].values[0][0]) || 0;
                  const combined = old + Number(repeatCount || 1);
                  db.run(`UPDATE stream_history SET repeat_count = ${combined} WHERE stream_id = ${streamId} AND access_date = ${accessDateSec}`);
                } else {
                  historyInsert.run([streamId, accessDateSec, Number(repeatCount || 1)]);
                }
              } else {
                // generate/new DB
                historyInsert.run([streamId, accessDateSec, Number(repeatCount || 1)]);
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

    log(`Processed ${histCount} history items.`);
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

  const blob = await zip.generateAsync({type:"blob"});
  const timestamp = getTimestamp();
  downloadFile(blob, "newpipe_converted.zip", timestamp);
  log("Done! File downloaded.", "info");
}

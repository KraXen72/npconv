import { log } from './logger';
// SQL helper: initialize sql.js and provide schema utilities
// Use static imports so Vite can resolve and emit the wasm asset at build time.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import type { Database, SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export async function initSQL(): Promise<SqlJsStatic> {
  try {
    return await initSqlJs({ locateFile: () => String(wasmUrl) });
  } catch {
    // Fallback: attempt to initialize without explicit locateFile
    try {
      return await initSqlJs();
    } catch (e2: any) {
      log('Failed to initialize sql.js: ' + (e2.message || e2.toString()), 'err');
      throw e2;
    }
  }
}

export function createSchema(db: Database) {
  log("Generating NewPipe Schema (excluding sqlite_sequence)...", "schema");
  const stmts: string[] = [
    "PRAGMA foreign_keys = ON",
    "CREATE TABLE IF NOT EXISTS android_metadata (locale TEXT)",
    `CREATE TABLE IF NOT EXISTS subscriptions (uid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, service_id INTEGER NOT NULL, url TEXT, name TEXT, avatar_url TEXT, subscriber_count INTEGER, description TEXT, notification_mode INTEGER NOT NULL)` ,
    `CREATE UNIQUE INDEX IF NOT EXISTS index_subscriptions_service_id_url ON subscriptions (service_id, url)` ,
    `CREATE TABLE IF NOT EXISTS search_history (creation_date INTEGER, service_id INTEGER NOT NULL, search TEXT, id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL)` ,
    `CREATE INDEX IF NOT EXISTS index_search_history_search ON search_history (search)` ,
    `CREATE TABLE IF NOT EXISTS streams (uid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, service_id INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, stream_type TEXT NOT NULL, duration INTEGER NOT NULL, uploader TEXT NOT NULL, uploader_url TEXT, thumbnail_url TEXT, view_count INTEGER, textual_upload_date TEXT, upload_date INTEGER, is_upload_date_approximation INTEGER)` ,
    `CREATE UNIQUE INDEX IF NOT EXISTS index_streams_service_id_url ON streams (service_id, url)` ,
    `CREATE TABLE IF NOT EXISTS stream_history (stream_id INTEGER NOT NULL, access_date INTEGER NOT NULL, repeat_count INTEGER NOT NULL, PRIMARY KEY(stream_id, access_date), FOREIGN KEY(stream_id) REFERENCES streams(uid) ON UPDATE CASCADE ON DELETE CASCADE)` ,
    `CREATE TABLE IF NOT EXISTS stream_state (progress_time INTEGER NOT NULL, stream_id INTEGER NOT NULL, PRIMARY KEY(stream_id), FOREIGN KEY(stream_id) REFERENCES streams(uid) ON UPDATE CASCADE ON DELETE CASCADE)` ,
    `CREATE TABLE IF NOT EXISTS playlist_stream_join (playlist_id INTEGER NOT NULL, stream_id INTEGER NOT NULL, join_index INTEGER NOT NULL, PRIMARY KEY(playlist_id, join_index), FOREIGN KEY(stream_id) REFERENCES streams(uid) ON UPDATE CASCADE ON DELETE CASCADE, FOREIGN KEY(playlist_id) REFERENCES playlists(uid) ON UPDATE CASCADE ON DELETE CASCADE)` ,
    `CREATE INDEX IF NOT EXISTS index_playlist_stream_join_stream_id ON playlist_stream_join (stream_id)` ,
    `CREATE UNIQUE INDEX IF NOT EXISTS index_playlist_stream_join_playlist_id_join_index ON playlist_stream_join (playlist_id, join_index)` ,
    `CREATE TABLE IF NOT EXISTS playlists (uid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT, is_thumbnail_permanent INTEGER NOT NULL, thumbnail_stream_id INTEGER NOT NULL, display_index INTEGER NOT NULL)` ,
    `CREATE TABLE IF NOT EXISTS remote_playlists (uid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, service_id INTEGER NOT NULL, name TEXT, url TEXT, thumbnail_url TEXT, uploader TEXT, display_index INTEGER NOT NULL, stream_count INTEGER)` ,
    `CREATE TABLE IF NOT EXISTS feed (stream_id INTEGER NOT NULL, subscription_id INTEGER NOT NULL, PRIMARY KEY(stream_id, subscription_id), FOREIGN KEY(stream_id) REFERENCES streams(uid) ON UPDATE CASCADE ON DELETE CASCADE, FOREIGN KEY(subscription_id) REFERENCES subscriptions(uid) ON UPDATE CASCADE ON DELETE CASCADE)` ,
    `CREATE INDEX IF NOT EXISTS index_feed_subscription_id ON feed (subscription_id)` ,
    `CREATE TABLE IF NOT EXISTS feed_group_subscription_join (group_id INTEGER NOT NULL, subscription_id INTEGER NOT NULL, PRIMARY KEY(group_id, subscription_id), FOREIGN KEY(group_id) REFERENCES feed_group(uid) ON UPDATE CASCADE ON DELETE CASCADE, FOREIGN KEY(subscription_id) REFERENCES subscriptions(uid) ON UPDATE CASCADE ON DELETE CASCADE)` ,
    `CREATE INDEX IF NOT EXISTS index_feed_group_subscription_join_subscription_id ON feed_group_subscription_join (subscription_id)` ,
    `CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER, identity_hash TEXT)` ,
    `CREATE TABLE IF NOT EXISTS feed_group (uid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, icon_id INTEGER NOT NULL, sort_order INTEGER NOT NULL)` ,
    `CREATE INDEX IF NOT EXISTS index_feed_group_sort_order ON feed_group (sort_order)` ,
    `INSERT OR IGNORE INTO android_metadata VALUES ('en_US')`
  ];

  db.run('BEGIN TRANSACTION');
  try {
    for (const s of stmts) {
      db.run(s);
    }
    db.run('COMMIT');
    log("Schema created.", "schema");
  } catch (e: any) {
    try { db.run('ROLLBACK'); } catch {}
    log('Failed to create schema: ' + (e.message || e.toString()), 'err');
    throw e;
  }
}

export function ensureStreamStateSchema(db: Database) {
  try {
    const fkRes = db.exec("PRAGMA foreign_key_list('stream_state')");
    const infoRes = db.exec("PRAGMA table_info('stream_state')");
    let hasFK = false;
    if (fkRes && fkRes.length > 0 && fkRes[0].values && fkRes[0].values.length > 0) hasFK = true;

    let colsOk = false;
    if (infoRes && infoRes.length > 0 && infoRes[0].values.length >= 2) {
      const rows = infoRes[0].values;
      const cols = rows.map((r: any) => r[1]);
      const pks = rows.map((r: any) => r[5]);
      if (cols[0] === 'progress_time' && cols[1] === 'stream_id' && pks[0] === 0 && pks[1] === 1) {
        colsOk = true;
      }
    }

    if (!hasFK || !colsOk) {
      log('Patching stream_state schema to Room-compatible definition...', 'schema');
      db.run('BEGIN TRANSACTION');
      const exists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='stream_state'");
      if (exists && exists.length > 0 && exists[0].values.length > 0) {
        db.run("ALTER TABLE stream_state RENAME TO stream_state_old");
        db.run("CREATE TABLE `stream_state` (`progress_time` INTEGER NOT NULL, `stream_id` INTEGER NOT NULL, PRIMARY KEY(`stream_id`), FOREIGN KEY(`stream_id`) REFERENCES `streams`(`uid`) ON UPDATE CASCADE ON DELETE CASCADE)");
        try {
          db.run("INSERT INTO stream_state (progress_time, stream_id) SELECT progress_time, stream_id FROM stream_state_old");
        } catch (e: any) {
          log('Note: could not copy old stream_state rows: ' + (e.message || e.toString()), 'warn');
        }
        db.run("DROP TABLE stream_state_old");
      } else {
        db.run("CREATE TABLE IF NOT EXISTS `stream_state` (`progress_time` INTEGER NOT NULL, `stream_id` INTEGER NOT NULL, PRIMARY KEY(`stream_id`), FOREIGN KEY(`stream_id`) REFERENCES `streams`(`uid`) ON UPDATE CASCADE ON DELETE CASCADE)");
      }
      db.run('COMMIT');
      log('stream_state schema patched.', 'schema');
    } else {
      log('stream_state schema OK.', 'schema');
    }
  } catch (e: any) {
    log('Failed to ensure stream_state schema: ' + (e.message || e.toString()), 'err');
  }
}

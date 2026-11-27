import JSZip from 'jszip';
import type { SqlJsStatic } from 'sql.js';
import * as v from 'valibot';
import { LibreTubeHistoryItemSchema } from '../schemas/libretube';
import { parseJsonWithSchema, parseWithSchema } from '../schemas/sql';
import { extractVideoIdFromUrl, formatUploadDate } from '../utils';
import type { HistoryImport, HistorySource, HistoryVideo } from './types';

const HISTORY_KEYS = ['watchHistory', 'history', 'watch_history', 'watch_history_items'] as const;
const HistoryItemSchema = v.object({
  ...LibreTubeHistoryItemSchema.entries,
  description: v.optional(v.nullable(v.string())),
  firstWatched: v.optional(v.union([v.string(), v.number()])),
  firstWatchedAt: v.optional(v.union([v.string(), v.number()])),
  firstAccessDate: v.optional(v.union([v.string(), v.number()])),
  lastWatchedAt: v.optional(v.union([v.string(), v.number()])),
});
const HistoryBackupSchema = v.pipe(
  v.record(v.string(), v.unknown()),
  v.check((backup) => HISTORY_KEYS.some((key) => key in backup), 'Expected a LibreTube watch-history array'),
);
const NewPipeHistorySchema = v.object({
  url: v.string(),
  title: v.nullable(v.string()),
  uploader: v.nullable(v.string()),
  uploader_url: v.nullable(v.string()),
  description: v.nullable(v.string()),
  first_date: v.nullable(v.number()),
  last_date: v.nullable(v.number()),
  watch_count: v.nullable(v.number()),
  upload_date: v.nullable(v.union([v.string(), v.number()])),
});

interface VideoFields {
  url?: string;
  videoId?: string;
  title?: string | null;
  description?: string | null;
  channel?: string | null;
  channelUrl?: string | null;
  firstWatchedAt: number | null;
  lastWatchedAt: number | null;
  uploadDate?: string | number | null;
  watchCount?: number | null;
}

function watchDate(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const numeric = Number(raw);
  const milliseconds = Number.isFinite(numeric)
    ? (numeric > 1e12 ? numeric : numeric * 1000)
    : Date.parse(String(raw));
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= 8.64e15
    ? Math.floor(milliseconds)
    : null;
}

function historyVideo(fields: VideoFields, source: HistorySource): HistoryVideo | null {
  let videoId = fields.videoId?.trim() || '';
  let url: URL | undefined;
  if (fields.url) {
    try {
      url = new URL(fields.url, source === 'LibreTube' ? 'https://www.youtube.com' : undefined);
    } catch {
      // an exported ID can still identify a LibreTube video with an invalid URL
    }
  }

  const youtube = source === 'LibreTube' || (url && (
    url.hostname === 'youtu.be' || url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')
  ));
  if (youtube) {
    videoId ||= extractVideoIdFromUrl(url?.href);
    if (!/^[\w-]+$/.test(videoId)) return null;
    url = new URL(`https://www.youtube.com/watch?v=${videoId}`);
  } else {
    if (!url || !['http:', 'https:'].includes(url.protocol)) return null;
    videoId = url.pathname.split('/').filter(Boolean).pop() || url.href;
  }

  return {
    id: url!.href,
    videoId,
    title: fields.title?.trim() || '',
    description: fields.description?.trim() || '',
    channel: fields.channel?.trim() || '',
    channelUrl: fields.channelUrl?.trim() || '',
    firstWatchedAt: fields.firstWatchedAt,
    lastWatchedAt: fields.lastWatchedAt,
    uploadDate: fields.uploadDate == null || fields.uploadDate === '' || fields.uploadDate === 0
      ? null
      : typeof fields.uploadDate === 'number' || /^\d+$/.test(fields.uploadDate)
        ? formatUploadDate(fields.uploadDate)
        : fields.uploadDate,
    sources: [{
      name: source,
      watchCount: fields.watchCount != null && Number.isSafeInteger(fields.watchCount) && fields.watchCount > 0
        ? fields.watchCount
        : null,
    }],
  };
}

/** Read every supported LibreTube history key; unrelated export sections stay untouched. */
export async function readLibreTubeHistory(file: File): Promise<HistoryImport> {
  const backup = parseJsonWithSchema(HistoryBackupSchema, await file.text(), 'LibreTube history');
  const videos: HistoryVideo[] = [];
  let skipped = 0;

  for (const key of HISTORY_KEYS) {
    if (!(key in backup)) continue;
    const entries = parseWithSchema(v.array(HistoryItemSchema), backup[key], `LibreTube ${key}`);
    for (const entry of entries) {
      const lastWatchedAt = watchDate(entry.lastWatchedAt ?? entry.lastWatched ?? entry.accessDate ?? entry.accessedAt ?? entry.timestamp ?? entry.date ?? entry.time);
      const firstWatchedAt = watchDate(entry.firstWatchedAt ?? entry.firstWatched ?? entry.firstAccessDate);
      const video = historyVideo({
        videoId: entry.videoId || entry.videoIdStr || entry.id,
        url: entry.url,
        title: entry.title || entry.name,
        description: entry.description,
        channel: entry.uploader || entry.uploaderName,
        channelUrl: entry.uploaderUrl,
        firstWatchedAt,
        lastWatchedAt,
        uploadDate: entry.uploadDate,
        watchCount: entry.watchCount ?? entry.repeatCount ?? entry.playCount ?? entry.repeat_count,
      }, 'LibreTube');
      if (video) videos.push(video);
      else skipped++;
    }
  }

  return { videos, skipped };
}

/** Join NewPipe's watched streams to their metadata and release the read-only database. */
export async function readNewPipeHistory(file: File, SQL: SqlJsStatic): Promise<HistoryImport> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const database = zip.file('newpipe.db');
  if (!database) throw new Error('NewPipe ZIP must contain newpipe.db');
  const db = new SQL.Database(await database.async('uint8array'));

  try {
    const columns = new Set(db.exec('PRAGMA table_info(streams)')[0]?.values.map((row) => row[1]));
    const description = columns.has('description') ? 's.description' : 'NULL';
    const channelUrl = columns.has('uploader_url') ? 's.uploader_url' : 'NULL';
    const uploadDate = columns.has('upload_date') ? 's.upload_date' : 'NULL';
    const textualUploadDate = columns.has('textual_upload_date') ? 's.textual_upload_date' : 'NULL';
    const statement = db.prepare(`
      SELECT s.url, s.title, s.uploader, ${channelUrl} AS uploader_url,
        ${description} AS description,
        MIN(CASE WHEN h.access_date > 0 THEN h.access_date END) AS first_date,
        MAX(CASE WHEN h.access_date > 0 THEN h.access_date END) AS last_date,
        SUM(h.repeat_count) AS watch_count,
        COALESCE(NULLIF(${textualUploadDate}, ''), ${uploadDate}) AS upload_date
      FROM stream_history h JOIN streams s ON s.uid = h.stream_id
      GROUP BY s.uid
    `);
    const videos: HistoryVideo[] = [];
    let skipped = 0;

    try {
      while (statement.step()) {
        const row = parseWithSchema(NewPipeHistorySchema, statement.getAsObject(), 'NewPipe history row');
        const video = historyVideo({
          url: row.url,
          title: row.title,
          description: row.description,
          channel: row.uploader,
          channelUrl: row.uploader_url,
          firstWatchedAt: row.first_date && row.first_date <= 8.64e15 ? row.first_date : null,
          lastWatchedAt: row.last_date && row.last_date <= 8.64e15 ? row.last_date : null,
          uploadDate: row.upload_date,
          watchCount: row.watch_count,
        }, 'NewPipe');
        if (video) videos.push(video);
        else skipped++;
      }
    } finally {
      statement.free();
    }

    return { videos, skipped };
  } finally {
    db.close();
  }
}

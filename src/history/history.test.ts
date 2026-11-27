import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { fixtureFile } from '@tests/helpers/fixtures';
import { useSqlite } from '@tests/helpers/sqlite';
import { createSchema } from '../sqlHelper';
import { readLibreTubeHistory, readNewPipeHistory } from './import';
import { HistorySearch } from './search';
import { HISTORY_PAGE_SIZE } from './types';

const sqlite = useSqlite();
const firstWatch = Date.UTC(2025, 0, 1, 12);
const lastWatch = Date.UTC(2025, 1, 2, 18);

/** Build a small history export whose metadata stays visible in each test. */
function libreTubeFile(watchHistory: unknown[], extra: Record<string, unknown> = {}): File {
  return new File([JSON.stringify({ watchHistory, ...extra })], 'history.json', { type: 'application/json' });
}

/** Package a real NewPipe database with repeated watches and an unwatched stream. */
async function newPipeFile(description = false): Promise<File> {
  const db = new sqlite.SQL.Database();
  createSchema(db);
  if (description) db.run('ALTER TABLE streams ADD COLUMN description TEXT');
  for (const [uid, url, title] of [
    [1, 'https://www.youtube.com/watch?v=AB_cd-Ef123', 'Orbital mechanics'],
    [2, 'https://www.youtube.com/watch?v=unwatched12', 'Unwatched stream'],
    [3, 'javascript:alert(1)', 'Unsafe link'],
  ] as const) {
    db.run(`INSERT INTO streams (uid, service_id, url, title, stream_type, duration, uploader, uploader_url, upload_date)
      VALUES (?, 0, ?, ?, 'VIDEO_STREAM', 60, 'Space School', 'https://www.youtube.com/@spaceschool', 1700000000)`, [uid, url, title]);
  }
  db.run('INSERT INTO stream_history VALUES (1, ?, 2), (1, ?, 3), (3, ?, 1)', [firstWatch, lastWatch, lastWatch]);
  if (description) db.run("UPDATE streams SET description = 'Elliptical trajectories' WHERE uid = 1");
  const bytes = db.export();
  db.close();
  const zip = new JSZip().file('newpipe.db', bytes);
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'history.zip');
}

describe('watch-history imports', () => {
  test.each([false, true])('shows recorded NewPipe dates and total plays when description column exists: %s', async (description) => {
    const file = await newPipeFile(description);

    const imported = await readNewPipeHistory(file, sqlite.SQL);
    const result = new HistorySearch(imported.videos).search('orbital');

    expect(imported.skipped).toBe(1);
    expect(result.videos).toEqual([expect.objectContaining({
      videoId: 'AB_cd-Ef123',
      title: 'Orbital mechanics',
      firstWatchedAt: firstWatch,
      lastWatchedAt: lastWatch,
      uploadDate: '2023-11-14',
      description: description ? 'Elliptical trajectories' : '',
      sources: [{ name: 'NewPipe', watchCount: 5 }],
    })]);
    expect(new HistorySearch(imported.videos).search('unwatched').videos).toEqual([]);
  });

  test.each(['watchHistory', 'history', 'watch_history', 'watch_history_items'])('reads metadata when LibreTube uses %s', async (key) => {
    const file = libreTubeFile([], { [key]: [{
      videoIdStr: 'AB_cd-Ef123', name: 'Orbital mechanics', uploaderName: 'Space School',
      uploaderUrl: 'https://www.youtube.com/@spaceschool', description: 'Elliptical trajectories',
      firstWatched: String(firstWatch / 1000), lastWatchedAt: new Date(lastWatch).toISOString(),
      uploadDate: '2024-06-01', watchCount: 7,
    }] });

    const imported = await readLibreTubeHistory(file);
    const search = new HistorySearch(imported.videos);

    expect(search.search('elliptical', 'description').videos[0]).toMatchObject({
      id: 'https://www.youtube.com/watch?v=AB_cd-Ef123',
      firstWatchedAt: firstWatch, lastWatchedAt: lastWatch, uploadDate: '2024-06-01',
      sources: [{ name: 'LibreTube', watchCount: 7 }],
    });
    expect(search.search('spaceschool', 'channel').videos[0].videoId).toBe('AB_cd-Ef123');
  });

  test('keeps missing dates and counts unavailable when LibreTube contains only video metadata', async () => {
    const file = libreTubeFile([{ videoId: 'AB_cd-Ef123', title: 'Orbital mechanics' }]);

    const imported = await readLibreTubeHistory(file);

    expect(imported.videos[0]).toMatchObject({
      firstWatchedAt: null, lastWatchedAt: null, uploadDate: null,
      sources: [{ name: 'LibreTube', watchCount: null }],
    });
  });

  test('merges sources without adding overlapping counts when both exports contain a video', async () => {
    const newpipe = await readNewPipeHistory(await newPipeFile(), sqlite.SQL);
    const libretube = await readLibreTubeHistory(libreTubeFile([{
      videoId: 'AB_cd-Ef123', title: 'Updated orbital mechanics',
      accessDate: lastWatch + 1000, repeatCount: 4, description: 'Elliptical trajectories',
    }]));

    const search = new HistorySearch([...newpipe.videos, ...libretube.videos, ...libretube.videos]);
    const result = search.search('elliptical');

    expect(result.videos).toEqual([expect.objectContaining({
      title: 'Updated orbital mechanics', firstWatchedAt: firstWatch, lastWatchedAt: lastWatch + 1000,
      uploadDate: '2023-11-14', sources: [
        { name: 'NewPipe', watchCount: 5 }, { name: 'LibreTube', watchCount: 4 },
      ],
    })]);
  });

  test('rejects malformed backups and skips entries without usable video links', async () => {
    const invalidJson = new File(['{'], 'broken.json');
    const noHistory = new File(['{"subscriptions":[]}'], 'other.json');
    const zip = new JSZip().file('preferences.json', '{}');
    const missingDb = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'other.zip');
    const file = libreTubeFile([{ title: 'Missing ID' }, { url: 'javascript:alert(1)' }, { url: 'https://youtu.be/AB_cd-Ef123' }]);

    const imported = await readLibreTubeHistory(file);

    expect(imported.skipped).toBe(2);
    expect(imported.videos.map((video) => video.id)).toEqual(['https://www.youtube.com/watch?v=AB_cd-Ef123']);
    await expect(readLibreTubeHistory(invalidJson)).rejects.toThrow('not valid JSON');
    await expect(readLibreTubeHistory(noHistory)).rejects.toThrow('watch-history array');
    await expect(readLibreTubeHistory(libreTubeFile([], { history: 'invalid' }))).rejects.toThrow('LibreTube history');
    await expect(readNewPipeHistory(missingDb, sqlite.SQL)).rejects.toThrow('newpipe.db');
  });

  test('searches saved real exports when dates and descriptions differ between apps', async () => {
    const newpipe = await readNewPipeHistory(await fixtureFile('fixture-NewPipeData-20251216_181353.zip'), sqlite.SQL);
    const libretube = await readLibreTubeHistory(await fixtureFile('fixture-libretube-backup-2026-05-24-08_41_14.json'));

    const search = new HistorySearch([...newpipe.videos, ...libretube.videos]);
    const result = search.search('lsvZdADkM5U', 'videoId');

    expect(result.videos.map((video) => video.videoId)).toEqual(['lsvZdADkM5U']);
    expect(result.videos[0].sources.some((source) => source.name === 'NewPipe')).toBe(true);
  });
});

describe('indexed history queries', () => {
  test('matches words across fields, accents, prefixes, and typos when all fields are selected', async () => {
    const imported = await readLibreTubeHistory(libreTubeFile([
      { videoId: 'AB_cd-Ef123', title: 'Café orbital mechanics', description: 'Elliptical trajectories', uploader: 'Space School' },
      { videoId: 'otherVideo1', title: 'Orbital cooking', description: 'Kitchen recipes', uploader: 'Food School' },
    ]));
    const search = new HistorySearch(imported.videos);

    const combined = search.search('CAFE traject space');
    const typo = search.search('ellipticel');
    const wrongField = search.search('elliptical', 'title');

    expect(combined.videos.map((video) => video.videoId)).toEqual(['AB_cd-Ef123']);
    expect(typo.videos.map((video) => video.videoId)).toEqual(['AB_cd-Ef123']);
    expect(wrongField.videos).toEqual([]);
    expect(search.search('orbital recipes space').videos).toEqual([]);
  });

  test('finds IDs with punctuation and pasted URLs when searching video IDs', async () => {
    const imported = await readLibreTubeHistory(libreTubeFile([{ videoId: 'AB_cd-Ef123', title: 'Orbital mechanics' }]));
    const search = new HistorySearch(imported.videos);

    const fullId = search.search('ab_CD-ef123', 'videoId');
    const prefix = search.search('AB_cd-', 'videoId');
    const url = search.search('https://youtu.be/AB_cd-Ef123?t=30');

    expect(fullId.videos.map((video) => video.videoId)).toEqual(['AB_cd-Ef123']);
    expect(prefix.videos).toEqual(fullId.videos);
    expect(url.videos).toEqual(fullId.videos);
    expect(search.search('AB_cd-Ef124', 'videoId').videos).toEqual([]);
  });

  test('ranks title matches above description matches when both contain the query', async () => {
    const imported = await readLibreTubeHistory(libreTubeFile([
      { videoId: 'titleVideo1', title: 'Astronomy', description: 'Planets and stars' },
      { videoId: 'descrVideo1', title: 'Another video', description: 'Astronomy' },
    ]));
    const search = new HistorySearch(imported.videos);

    const result = search.search('astronomy');

    expect(result.videos.map((video) => video.videoId)).toEqual(['titleVideo1', 'descrVideo1']);
  });

  test('returns bounded recent pages and resets cached rankings when the query changes', async () => {
    const entries = Array.from({ length: HISTORY_PAGE_SIZE * 2 + 3 }, (_, index) => ({
      videoId: `video_${index}`, title: `Astronomy lesson ${index}`, accessDate: firstWatch + index * 1000,
    }));
    const imported = await readLibreTubeHistory(libreTubeFile(entries));
    const search = new HistorySearch(imported.videos);

    const secondPage = search.search('', 'all', 1);
    const filtered = search.search('video_0', 'videoId', 10);
    const recentAgain = search.search('', 'all', 0);

    expect(secondPage.videos[0].videoId).toBe('video_42');
    expect(secondPage.videos[HISTORY_PAGE_SIZE - 1]?.videoId).toBe('video_3');
    expect(filtered).toMatchObject({ total: 1, page: 0 });
    expect(filtered.videos[0].videoId).toBe('video_0');
    expect(recentAgain.videos[0].videoId).toBe('video_82');
  });
});

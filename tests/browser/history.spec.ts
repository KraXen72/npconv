import { expect, test } from '@playwright/test';
import initSqlJs from 'sql.js';
import JSZip from 'jszip';

const videoId = 'AB_cd-Ef123';
const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
const firstWatch = Date.UTC(2025, 0, 1, 12);
const lastWatch = Date.UTC(2025, 1, 2, 18);
let newpipe: Buffer;
const libretube = Buffer.from(JSON.stringify({ watchHistory: [{
  videoId, title: 'Café orbital mechanics', description: 'Elliptical trajectories',
  uploader: 'Space School', uploaderUrl: 'https://www.youtube.com/@spaceschool',
  firstWatched: firstWatch / 1000, accessDate: lastWatch, watchCount: 7, uploadDate: '2024-06-01',
}] }));

test.beforeAll(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE streams (
    uid INTEGER PRIMARY KEY, service_id INTEGER, url TEXT, title TEXT,
    stream_type TEXT, duration INTEGER, uploader TEXT, uploader_url TEXT, upload_date INTEGER
  )`);
  db.run('CREATE TABLE stream_history (stream_id INTEGER, access_date INTEGER, repeat_count INTEGER)');
  db.run(`INSERT INTO streams (uid, service_id, url, title, stream_type, duration, uploader, uploader_url, upload_date)
    VALUES (1, 0, ?, 'Café orbital mechanics', 'VIDEO_STREAM', 60, 'Space School', 'https://www.youtube.com/@spaceschool', 1700000000)`, [videoUrl]);
  db.run('INSERT INTO stream_history VALUES (1, ?, 2), (1, ?, 3)', [firstWatch, lastWatch]);
  const zip = new JSZip().file('newpipe.db', db.export());
  db.close();
  newpipe = await zip.generateAsync({ type: 'nodebuffer' });
});

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.locator('#video-action').selectOption('history');
});

for (const source of ['NewPipe', 'LibreTube'] as const) {
  test(`searches ${source} metadata and opens a video in a separate tab when either export is uploaded`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const zone = source === 'NewPipe' ? '#zone-left' : '#zone-right';

    await page.locator(`${zone} input[type=file]`).setInputFiles({
      name: source === 'NewPipe' ? 'history.zip' : 'history.json',
      mimeType: source === 'NewPipe' ? 'application/zip' : 'application/json',
      buffer: source === 'NewPipe' ? newpipe : libretube,
    });
    await expect(page.getByRole('status')).toContainText('1 watched video');
    await page.getByRole('searchbox', { name: 'Search history' }).fill('CAFE orbital');
    const result = page.locator('.history-video');

    await expect(result).toHaveCount(1);
    await expect(result.locator('time').first()).toHaveAttribute('datetime', new Date(firstWatch).toISOString());
    await expect(result.locator('time').last()).toHaveAttribute('datetime', new Date(lastWatch).toISOString());
    await expect(result).toContainText(source === 'NewPipe' ? 'NewPipe · 5 watches' : 'LibreTube · 7 watches');
    await expect(result).toContainText(source === 'NewPipe' ? '2023-11-14' : '2024-06-01');
    await expect(result).toHaveAttribute('href', videoUrl);
    await expect(result).toHaveAttribute('rel', 'noopener noreferrer');

    await page.context().route('https://www.youtube.com/**', (route) => route.fulfill({ body: '<title>Video</title>' }));
    const popupPromise = page.waitForEvent('popup');
    await result.click();
    const popup = await popupPromise;
    await popup.waitForURL(videoUrl);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    expect(errors).toEqual([]);
  });
}

test('searches descriptions and channels, keeps counts separate, and retains files across video actions', async ({ page }) => {
  await page.locator('#zone-left input[type=file]').setInputFiles({ name: 'history.zip', mimeType: '', buffer: newpipe });
  await page.locator('#zone-right input[type=file]').setInputFiles({ name: 'history.json', mimeType: '', buffer: libretube });

  await expect(page.getByRole('status')).toContainText('1 watched video');
  await page.locator('#history-field').selectOption('description');
  await page.locator('#history-query').fill('ellipticel');

  await expect(page.locator('.history-video')).toHaveCount(1);
  await expect(page.locator('.history-video')).toContainText('NewPipe · 5 watches');
  await expect(page.locator('.history-video')).toContainText('LibreTube · 7 watches');
  await page.locator('#history-field').selectOption('title');
  await expect(page.getByRole('status')).toContainText('No matching videos');
  await page.locator('#history-field').selectOption('channel');
  await page.locator('#history-query').fill('spaceschool');
  await expect(page.locator('.history-video')).toHaveCount(1);
  await page.locator('#video-action').selectOption('convert');
  await expect(page.locator('#zone-left .file-name')).toHaveText('history.zip');
  await page.locator('#video-action').selectOption('history');
  await expect(page.getByRole('status')).toContainText('1 watched video');
});

test('replaces and clears the current index and recovers from malformed uploads', async ({ page }) => {
  await page.locator('#zone-right input[type=file]').setInputFiles({ name: 'history.json', mimeType: '', buffer: libretube });
  await expect(page.locator('.history-video')).toHaveCount(1);

  await page.locator('#zone-right input[type=file]').setInputFiles({ name: 'broken.json', mimeType: '', buffer: Buffer.from('{') });

  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  await expect(page.locator('.history-video')).toHaveCount(0);
  await page.locator('#zone-right input[type=file]').setInputFiles({
    name: 'replacement.json', mimeType: '', buffer: Buffer.from(JSON.stringify({ watchHistory: [{ videoId: 'newVideo123', title: 'Replacement video' }] })),
  });
  await expect(page.locator('.history-video')).toContainText('Replacement video');
  await expect(page.locator('.history-video time')).toHaveCount(0);
  await expect(page.locator('.history-video')).not.toContainText('watches');
  await page.locator('#zone-right').getByRole('button', { name: 'Clear file' }).click();
  await expect(page.locator('.history-video')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Choose a NewPipe ZIP');
});

for (const width of [1280, 390, 320]) {
  test(`keeps searchable results and pagination usable at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    const entries = Array.from({ length: 45 }, (_, index) => ({
      videoId: `video_${index}`, title: `Astronomy lesson ${index} with a long title that wraps on narrow screens`,
      uploader: 'Space School', accessDate: firstWatch + index * 1000,
    }));

    await page.locator('#zone-right input[type=file]').setInputFiles({
      name: 'history.json', mimeType: '', buffer: Buffer.from(JSON.stringify({ watchHistory: entries })),
    });
    await expect(page.getByRole('status')).toContainText('45 watched videos');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
    await expect(page.locator('.history-video').first()).toContainText('Astronomy lesson 4 ');
    await page.locator('#history-query').fill('video_0');
    await page.locator('#history-field').selectOption('videoId');

    await expect(page.locator('.history-video')).toHaveCount(1);
    await expect(page.locator('.history-video')).toContainText('Astronomy lesson 0 ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#history-query').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/npconv-history-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

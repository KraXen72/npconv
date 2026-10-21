import { expect, test, type Page } from '@playwright/test';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addHabit, addRepetition, createHabitTables } from '../helpers/habits';

let SQL: SqlJsStatic;
let fixture: Buffer;
const day = (date: number) => Date.UTC(2025, 0, date);

test.beforeAll(async () => {
  SQL = await initSqlJs();
  const db = new SQL.Database();
  // synthetic fruit names and notes keep browser fixtures independent of personal backups
  createHabitTables(db);
  for (const [id, name, type] of [
    [1, 'Apple', 0],
    [2, 'Pear', 1],
    [3, 'Plum', 0],
  ] as const) {
    addHabit(db, id, name, type, type === 1 ? 'cups' : '', 2.5);
  }
  for (const [habit, values] of [
    [1, [2, 0, 3, -1]],
    [2, [2500, 0, 2499, -1]],
    [3, [0]],
  ] as const) {
    values.forEach((value, index) =>
      addRepetition(db, {
        habitId: habit,
        timestamp: day(index + 1),
        value,
        notes: `${habit === 1 ? 'Apple' : 'Pear'} ${index + 1}`,
      })
    );
  }
  fixture = Buffer.from(db.export());
  db.close();
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'npconv backup converter' })).toBeVisible();
});

async function upload(page: Page, real = false) {
  await page.getByText('Edit uHabits', { exact: true }).click();
  await page
    .locator('#zone-uhabits input[type=file]')
    .setInputFiles(
      real
        ? resolve('fixtures/habit-backfill/fixture-uhabits-anonymized.db')
        : { name: 'fruit.db', mimeType: 'application/x-sqlite3', buffer: fixture }
    );
  await expect(page.locator('#edit-source option')).not.toHaveCount(1);
}

async function downloadDb(page: Page): Promise<Database> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download edited backup' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^uhabits_.*\.db$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  return new SQL.Database(await readFile(path!));
}

function values(db: Database, id: number) {
  return (
    db
      .exec('SELECT value FROM Repetitions WHERE habit = ? ORDER BY timestamp', [id])[0]
      ?.values.flat() ?? []
  );
}

test('workflow selector exposes only supported app routes and resets files between workflows', async ({
  page,
}) => {
  await expect(page.getByRole('radiogroup')).toHaveCount(1);
  await expect(page.locator('#video-action option')).toHaveText([
    'Merge backups',
    'Convert backup',
  ]);
  await page.locator('#video-action').selectOption('convert');
  await expect(page.getByRole('button', { name: 'Target: NewPipe' })).toBeVisible();
  await page.getByText('Import habit data', { exact: true }).click();
  await expect(page.locator('#habit-source option')).toHaveText(['SimpleTimeTracker', 'TimeJot']);
  await expect(page.getByText('→ uHabits', { exact: true })).toBeVisible();
  await page.locator('#habit-source').selectOption('timejot');
  await expect(page.getByRole('heading', { name: 'TimeJot Export (.db)' })).toBeVisible();
  await page
    .locator('#zone-left input[type=file]')
    .setInputFiles(resolve('fixtures/habit-backfill/fixture-timejot-anonymized.db'));
  await expect(page.locator('#zone-left .file-name')).toContainText('fixture-timejot');
  await page.locator('#habit-source').selectOption('stt');
  await expect(page.locator('#zone-left .file-name')).toBeEmpty();
  await expect(page.locator('#zone-left input[type=file]')).toHaveValue('');
  await upload(page);
  await expect(page.locator('#main-file-area')).toHaveCount(0);
  await page.getByText('Video backups', { exact: true }).click();
  await expect(page.locator('#zone-left .file-name')).toBeEmpty();
  await page.getByText('Edit uHabits', { exact: true }).click();
  await expect(page.locator('#edit-source option')).toHaveCount(1);
});

for (const source of ['1', '2']) {
  test(`changes habit ${source} type and verifies downloaded SQLite values`, async ({ page }) => {
    await upload(page);
    await expect(page.getByRole('button', { name: 'Download edited backup' })).toBeDisabled();
    await page.locator('#edit-source').selectOption(source);
    if (source === '1') {
      await page.locator('#checked-value').fill('1.25');
      await page.locator('#numeric-unit').fill('cups');
      await page.locator('#numeric-goal').fill('3');
    }
    const db = await downloadDb(page);
    try {
      expect(values(db, Number(source))).toEqual(
        source === '1' ? [1250, 0, -1, -1] : [2, 0, 0, -1]
      );
      expect(db.exec('SELECT type FROM Habits WHERE id = ?', [Number(source)])[0].values).toEqual([
        [source === '1' ? 1 : 0],
      ]);
      expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']]);
    } finally {
      db.close();
    }
    await expect(page.getByRole('status')).toContainText('4 entries written');
  });
}

for (const source of ['1', '2']) {
  test(`fills across habit types from ${source} with contextual destinations`, async ({ page }) => {
    await upload(page);
    await page.locator('#habit-action').selectOption('fill');
    await page.locator('#edit-source').selectOption(source);
    const destination = source === '1' ? '2' : '3';
    await expect(page.locator('#edit-target option')).toHaveText(
      source === '1'
        ? ['Select a habit…', 'Pear (numerical)']
        : ['Select a habit…', 'Apple (boolean)', 'Plum (boolean)']
    );
    await page.locator('#edit-target').selectOption(destination);
    if (source === '1') await page.locator('#checked-value').fill('1.25');
    await page.getByRole('checkbox', { name: 'Replace existing days' }).check();
    const db = await downloadDb(page);
    try {
      expect(values(db, Number(destination))).toEqual(
        source === '1' ? [1250, 0, -1, -1] : [2, 0, 0, -1]
      );
      expect(values(db, Number(source))).toEqual(
        source === '1' ? [2, 0, 3, -1] : [2500, 0, 2499, -1]
      );
    } finally {
      db.close();
    }
  });
}

test('copies an inclusive boolean section, keeps overlaps, and validates dates', async ({
  page,
}) => {
  await upload(page);
  await page.locator('#habit-action').selectOption('copy');
  await expect(page.locator('#edit-source option')).toHaveText([
    'Select a habit…',
    'Apple (boolean)',
    'Plum (boolean)',
  ]);
  await page.locator('#edit-source').selectOption('1');
  await expect(page.locator('#edit-target option')).toHaveText([
    'Select a habit…',
    'Plum (boolean)',
  ]);
  await page.locator('#edit-target').selectOption('3');
  const button = page.getByRole('button', { name: 'Download edited backup' });
  await expect(button).toBeDisabled();
  await page.locator('#range-start').fill('2025-01-03');
  await page.locator('#range-end').fill('2025-01-01');
  await expect(page.getByRole('alert')).toContainText('Start date');
  await expect(button).toBeDisabled();
  await page.locator('#range-start').fill('2025-01-01');
  await page.locator('#range-end').fill('2025-01-03');
  const db = await downloadDb(page);
  try {
    expect(values(db, 3)).toEqual([0, 0, 3]);
    expect(
      db.exec('SELECT notes FROM Repetitions WHERE habit = 3 ORDER BY timestamp')[0].values
    ).toEqual([['Pear 1'], ['Apple 2'], ['Apple 3']]);
  } finally {
    db.close();
  }
  await expect(page.getByRole('status')).toContainText(
    '2 entries written, 1 existing entries preserved'
  );
});

test('invalid numeric rules disable downloads and replacing or clearing a file clears selections', async ({
  page,
}) => {
  await upload(page);
  await page.locator('#edit-source').selectOption('1');
  const button = page.getByRole('button', { name: 'Download edited backup' });
  for (const value of ['', '0', '-1', '2147484']) {
    await page.locator('#checked-value').fill(value);
    await expect(button).toBeDisabled();
  }
  await page.locator('#checked-value').fill('2');
  await expect(button).toBeEnabled();
  await page.getByRole('button', { name: 'Clear file' }).click();
  await expect(page.locator('#edit-source option')).toHaveCount(1);
  await expect(button).toBeDisabled();
  await page
    .locator('#zone-uhabits input[type=file]')
    .setInputFiles({ name: 'corrupt.db', mimeType: '', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('log')).toContainText('Error loading uHabits');
  await expect(button).toBeDisabled();
});

test('real anonymized backup loads and exports an intact edited database', async ({ page }) => {
  await upload(page, true);
  const numeric = await page
    .locator('#edit-source option')
    .filter({ hasText: '(numerical)' })
    .first()
    .getAttribute('value');
  await page.locator('#edit-source').selectOption(numeric!);
  const db = await downloadDb(page);
  try {
    expect(db.exec('SELECT COUNT(*) FROM Habits')[0].values).toEqual([[31]]);
    expect(db.exec('SELECT COUNT(*) FROM Repetitions')[0].values).toEqual([[8094]]);
    expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']]);
  } finally {
    db.close();
  }
});

test('editor fits a mobile viewport without horizontal scrolling or browser errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await upload(page);
  await page.locator('#edit-source').selectOption('2');
  await page.screenshot({ path: '/tmp/npconv-habit-editor-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#edit-source').selectOption('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await expect(page.locator('#numeric-goal')).toBeVisible();
  await page.screenshot({ path: '/tmp/npconv-habit-editor-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

for (const sourceKind of ['stt', 'timejot'] as const) {
  test(`existing ${sourceKind} import still downloads a filled Loop backup`, async ({ page }) => {
    await page.getByText('Import habit data', { exact: true }).click();
    await page.locator('#habit-source').selectOption(sourceKind);
    await page
      .locator('#zone-left input[type=file]')
      .setInputFiles(
        resolve(
          `fixtures/habit-backfill/fixture-${sourceKind}-anonymized.${sourceKind === 'stt' ? 'backup' : 'db'}`
        )
      );
    await page
      .locator('#zone-right input[type=file]')
      .setInputFiles(resolve('fixtures/habit-backfill/fixture-uhabits-anonymized.db'));
    await page.locator('.stt-activity-select').selectOption(sourceKind === 'stt' ? '1' : '6');
    await page.locator('.uhabits-habit-select').selectOption(sourceKind === 'stt' ? '9' : '35');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Fill', exact: true }).click();
    const download = await pending;
    const db = new SQL.Database(await readFile((await download.path())!));
    try {
      expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']]);
      expect(Number(db.exec('SELECT COUNT(*) FROM Repetitions')[0].values[0][0])).toBeGreaterThan(
        8094
      );
    } finally {
      db.close();
    }
  });
}

for (const mode of ['convert', 'merge']) {
  for (const target of ['newpipe', 'libretube']) {
    test(`existing video ${mode} to ${target} still downloads a valid backup`, async ({ page }) => {
      await page.locator('#video-action').selectOption(mode);
      await page
        .locator('#zone-left input[type=file]')
        .setInputFiles(resolve('fixtures/fixture-NewPipeData-20251216_181353.zip'));
      await page
        .locator('#zone-right input[type=file]')
        .setInputFiles(resolve('fixtures/fixture-libretube-backup-2026-05-24-08_41_14.json'));
      if (mode === 'merge' && target === 'libretube') {
        await page.locator('label.two-way').click();
        await expect(page.getByRole('checkbox', { name: 'Merge direction' })).toBeChecked();
      }
      const pending = page.waitForEvent('download');
      await page.locator(mode === 'merge' ? '#btn-merge' : `#btn-to-${target}`).click();
      const download = await pending;
      const bytes = await readFile((await download.path())!);
      if (target === 'libretube') {
        expect(JSON.parse(bytes.toString())).toHaveProperty('subscriptions');
      } else {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(bytes);
        const db = new SQL.Database(await zip.file('newpipe.db')!.async('uint8array'));
        try {
          expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']]);
        } finally {
          db.close();
        }
      }
    });
  }
}

const resultCell = (page: Page, date: string) =>
  page.locator('.edit-preview activity-grid').locator(`.cell[data-date="${date}"]`);

test('live numerical conversion reacts to threshold and comparison and shows source / before histories', async ({
  page,
}) => {
  await upload(page);
  await page.locator('#habit-action').selectOption('fill');
  await page.locator('#edit-source').selectOption('2');
  await page.locator('#edit-target').selectOption('3');
  await page.getByRole('checkbox', { name: 'Replace existing days' }).check();
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-value', '2');
  await expect(resultCell(page, '2025-01-02')).toHaveAttribute('data-value', '0');
  await page.locator('#numeric-comparison').selectOption('at-most');
  await page.locator('#numeric-threshold').fill('0');
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-value', '0');
  await expect(resultCell(page, '2025-01-02')).toHaveAttribute('data-value', '2');
  await expect(resultCell(page, '2025-01-04')).toHaveAttribute('data-value', '-1');
  await expect(resultCell(page, '2025-01-05')).toHaveAttribute('data-value', '');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-value', '2500');
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-value', '0');
  await page.getByRole('button', { name: 'Result', exact: true }).click();
  await resultCell(page, '2025-01-02').click();
  await expect(page.locator('.preview-day-detail')).toContainText('2025-01-02 · Checked · Written');
  await page.locator('#range-start').fill('2025-01-03');
  await expect(resultCell(page, '2025-01-02')).toHaveAttribute('data-value', '');
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-written', 'false');
  await page.locator('#numeric-threshold').fill('');
  await expect(page.getByRole('region', { name: 'Live habit preview' })).toHaveCount(0);
});

test('boolean conversion preview reacts to checked amount, goal and unit without changing source history', async ({
  page,
}) => {
  await upload(page);
  await page.locator('#edit-source').selectOption('1');
  await page.locator('#checked-value').fill('1.25');
  const cell = resultCell(page, '2025-01-01');
  await expect(cell).toHaveAttribute('data-value', '1250');
  const originalColor = await cell.evaluate(
    (element) => (element as HTMLElement).style.backgroundColor
  );
  await page.locator('#numeric-goal').fill('10');
  await expect
    .poll(() => cell.evaluate((element) => (element as HTMLElement).style.backgroundColor))
    .not.toBe(originalColor);
  await page.locator('#numeric-unit').fill('cups');
  await expect(cell).toHaveAttribute('title', /1.25 cups/);
  await expect(resultCell(page, '2025-01-03')).toHaveAttribute('data-value', '-1');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(cell).toHaveAttribute('data-value', '2');
  await expect(resultCell(page, '2025-01-03')).toHaveAttribute('title', /Skipped/);
});

test('boolean range preview responds to bounds and replacement and matches downloaded values', async ({
  page,
}) => {
  await upload(page);
  await page.locator('#habit-action').selectOption('copy');
  await page.locator('#edit-source').selectOption('1');
  await page.locator('#edit-target').selectOption('3');
  await page.locator('#range-start').fill('2025-01-01');
  await page.locator('#range-end').fill('2025-01-03');
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-value', '0');
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-written', 'false');
  await page.getByRole('checkbox', { name: 'Replace existing days' }).check();
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-value', '2');
  await page.locator('#range-end').fill('2025-01-02');
  await expect(resultCell(page, '2025-01-03')).toHaveAttribute('data-value', '');
  const db = await downloadDb(page);
  try {
    expect(values(db, 3)).toEqual([2, 0]);
  } finally {
    db.close();
  }
});

for (const width of [390, 320]) {
  test(`all edit controls and live previews fit together at ${width}px without a floating panel`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await upload(page);
    for (const [action, source, target] of [
      ['change-type', '1', ''],
      ['change-type', '2', ''],
      ['fill', '1', '2'],
      ['fill', '2', '3'],
      ['copy', '1', '3'],
    ]) {
      await page.locator('#habit-action').selectOption(action);
      await page.locator('#edit-source').selectOption(source);
      if (target) await page.locator('#edit-target').selectOption(target);
      if (action === 'copy') {
        await page.locator('#range-start').fill('2025-01-01');
        await page.locator('#range-end').fill('2025-01-04');
      }
      const workspace = page.locator('.edit-workspace');
      await workspace.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      for (const control of await workspace
        .locator('.editor-fields select, .editor-fields input, .overwrite-option input')
        .all()) {
        await control.focus();
        const bounds = await control.boundingBox();
        const graph = await page.locator('.edit-preview .activity-grid-container').boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(-1);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
        expect(graph!.y).toBeGreaterThanOrEqual(-1);
        expect(graph!.y + graph!.height, `${action} ${source} graph bottom`).toBeLessThanOrEqual(
          640
        );
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
    }
    await page.screenshot({ path: `/tmp/npconv-live-edit-${width}.png` });
  });
}

for (const kind of ['stt', 'timejot']) {
  test(`${kind} mapping controls and their own graph fit together on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByText('Import habit data', { exact: true }).click();
    await page.locator('#habit-source').selectOption(kind);
    await page
      .locator('#zone-left input[type=file]')
      .setInputFiles(
        resolve(
          `fixtures/habit-backfill/fixture-${kind}-anonymized.${kind === 'stt' ? 'backup' : 'db'}`
        )
      );
    await page
      .locator('#zone-right input[type=file]')
      .setInputFiles(resolve('fixtures/habit-backfill/fixture-uhabits-anonymized.db'));
    const mapping = page.locator('.mapping-item').first();
    await mapping.locator('.stt-activity-select').selectOption(kind === 'stt' ? '1' : '6');
    for (const destination of ['9', '35']) {
      await mapping.locator('.uhabits-habit-select').selectOption(destination);
      await mapping.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      for (const control of await mapping.locator('select, .mapping-options input').all()) {
        await control.focus();
        const bounds = await control.boundingBox();
        const graph = await mapping.locator('activity-grid').boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(-1);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
        expect(graph!.y).toBeGreaterThanOrEqual(-1);
        expect(graph!.y + graph!.height).toBeLessThanOrEqual(640);
      }
    }
    for (const element of await mapping.locator('.grid-year-nav, .activity-legend-item').all()) {
      const bounds = await element.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    await page.screenshot({ path: `/tmp/npconv-live-import-${kind}.png` });
  });
}

test('cancelling a category switch preserves editor files, settings and preview', async ({
  page,
}) => {
  await upload(page);
  await page.locator('#edit-source').selectOption('2');
  await page.locator('#numeric-threshold').fill('3.5');
  page.removeAllListeners('dialog');
  let confirmations = 0;
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('Discard');
    confirmations++;
    await dialog.dismiss();
  });

  await page.getByText('Import habit data', { exact: true }).click();

  expect(confirmations).toBe(1);
  await expect(page.getByRole('radio', { name: 'Edit uHabits' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Import habit data' })).not.toBeChecked();
  await expect(page.locator('#edit-source')).toHaveValue('2');
  await expect(page.locator('#numeric-threshold')).toHaveValue('3.5');
  await expect(page.locator('#zone-uhabits .file-name')).toHaveText('fruit.db');
  await expect(resultCell(page, '2025-01-01')).toHaveAttribute('data-value', '0');

  page.removeAllListeners('dialog');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByText('Import habit data', { exact: true }).click();
  await expect(page.locator('#habit-source')).toBeVisible();
  await page.getByText('Edit uHabits', { exact: true }).click();
  await expect(page.locator('#edit-source')).toHaveValue('');
  await expect(page.locator('#zone-uhabits .file-name')).toBeEmpty();
});

test('import source and edit action selects restore their selection when discard is cancelled', async ({
  page,
}) => {
  await page.getByText('Import habit data', { exact: true }).click();
  await page
    .locator('#zone-left input[type=file]')
    .setInputFiles(resolve('fixtures/habit-backfill/fixture-stt-anonymized.backup'));
  await page.locator('.min-duration-input').fill('17');
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => dialog.dismiss());

  await page.locator('#habit-source').selectOption('timejot');
  await expect(page.locator('#habit-source')).toHaveValue('stt');
  await expect(page.locator('.min-duration-input')).toHaveValue('17');
  await expect(page.locator('#zone-left .file-name')).toContainText('fixture-stt');

  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => dialog.accept());
  await upload(page);
  await page.locator('#edit-source').selectOption('1');
  await page.locator('#checked-value').fill('2.75');
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.locator('#habit-action').selectOption('fill');
  await expect(page.locator('#habit-action')).toHaveValue('change-type');
  await expect(page.locator('#edit-source')).toHaveValue('1');
  await expect(page.locator('#checked-value')).toHaveValue('2.75');
});

test('pristine workflows and video switches that keep files do not prompt', async ({ page }) => {
  page.removeAllListeners('dialog');
  let prompts = 0;
  page.on('dialog', async (dialog) => {
    prompts++;
    await dialog.dismiss();
  });
  await page.getByText('Import habit data', { exact: true }).click();
  await page.locator('#habit-source').selectOption('timejot');
  await page.getByText('Edit uHabits', { exact: true }).click();
  await page.getByText('Video backups', { exact: true }).click();
  await page
    .locator('#zone-left input[type=file]')
    .setInputFiles(resolve('fixtures/fixture-NewPipeData-20251216_181353.zip'));
  await page.locator('#video-action').selectOption('convert');
  await expect(page.locator('#video-action')).toHaveValue('convert');
  await expect(page.locator('#zone-left .file-name')).toContainText('fixture-NewPipeData');
  expect(prompts).toBe(0);
});

test('partially entered settings without files also require discard confirmation', async ({
  page,
}) => {
  await page.getByText('Import habit data', { exact: true }).click();
  await page.locator('.min-duration-input').fill('22');
  page.removeAllListeners('dialog');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByText('Video backups', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Import habit data' })).toBeChecked();
  await expect(page.locator('.min-duration-input')).toHaveValue('22');
});

test('mapping rows and video merge settings are protected before files are uploaded', async ({
  page,
}) => {
  await page.getByText('Import habit data', { exact: true }).click();
  await page.getByRole('button', { name: '+ Add Mapping' }).click();
  await expect(page.locator('.mapping-item')).toHaveCount(2);
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.getByText('Video backups', { exact: true }).click();
  await expect(page.locator('.mapping-item')).toHaveCount(2);

  page.removeAllListeners('dialog');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByText('Video backups', { exact: true }).click();
  await page.locator('#playlist-behavior').selectOption('only_newpipe');
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.locator('#video-action').selectOption('convert');
  await expect(page.locator('#video-action')).toHaveValue('merge');
  await expect(page.locator('#playlist-behavior')).toHaveValue('only_newpipe');
});

test('planner validation errors are visible before a download can start', async ({ page }) => {
  const db = new SQL.Database(fixture);
  addRepetition(db, { habitId: 1, timestamp: day(1), value: 0, notes: 'Duplicate apple' });
  const duplicateFixture = Buffer.from(db.export());
  db.close();

  await page.getByText('Edit uHabits', { exact: true }).click();
  await page.locator('#zone-uhabits input[type=file]').setInputFiles({
    name: 'duplicate-fruit.db',
    mimeType: 'application/x-sqlite3',
    buffer: duplicateFixture,
  });
  await page.locator('#edit-source').selectOption('1');

  await expect(page.getByRole('alert')).toContainText('duplicate entries');
  await expect(page.getByRole('button', { name: 'Download edited backup' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Live habit preview' })).toHaveCount(0);
});

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GatedFile } from '@tests/helpers/files';
import { addHabit, createHabitTables, createTimeJotTables, sqliteFile, useSqlite } from '@tests/helpers/sqlite';
import { createSttStore, type SttStore } from './sttStore';

const sqlite = useSqlite();
let store: SttStore;
let sttFile: File;
let timeJotFile: File;
let habitsFile: File;

beforeEach(() => {
	store = createSttStore(sqlite.SQL);
	sttFile = new File(['recordType\t1\tReading\t📖\t0\t0'], 'reading.backup');
	const source = sqlite.open();
	createTimeJotTables(source);
	source.run("INSERT INTO events VALUES (1, 'Reading', 0)");
	source.run("INSERT INTO entries VALUES (1, 'Chapter one', 1, '2025-06-07T10:00:00+02:00', 0)");
	timeJotFile = sqliteFile(source.export(), 'timejot.db');
	const target = sqlite.open();
	createHabitTables(target);
	addHabit(target, 1, 'Read', 0);
	habitsFile = sqliteFile(target.export());
});

afterEach(() => {
	store.clearSources();
	store.clearUHabits();
});

describe('habit file store', () => {
	test('replaces STT data when a TimeJot file is loaded', async () => {
		await store.loadSttFile(sttFile);

		const loaded = await store.loadTimeJotFile(timeJotFile);

		expect(loaded).toBe(true);
		expect(store.sttData()).toBeNull();
		expect(store.sttFile()).toBeNull();
		expect(store.timeJotFile()).toBe(timeJotFile);
		expect(store.timeJotData()?.entries).toEqual([
			{ id: 1, eventId: 1, date: '2025-06-07T10:00:00+02:00', dayKey: '2025-06-07', note: 'Chapter one' }
		]);
	});

	test('replaces TimeJot data when an STT file is loaded', async () => {
		await store.loadTimeJotFile(timeJotFile);

		const loaded = await store.loadSttFile(sttFile);

		expect(loaded).toBe(true);
		expect(store.timeJotData()).toBeNull();
		expect(store.timeJotFile()).toBeNull();
		expect(store.sttFile()).toBe(sttFile);
		expect(store.sttData()?.recordTypes.get(1)?.name).toBe('Reading');
	});

	test.each(['stt', 'timejot'] as const)('preserves the newer source when a pending %s upload finishes last', async source => {
		const original = source === 'stt' ? sttFile : timeJotFile;
		const pendingFile = new GatedFile([original], 'older-upload');

		const pending = source === 'stt' ? store.loadSttFile(pendingFile) : store.loadTimeJotFile(pendingFile);
		const loaded = await store.loadSttFile(sttFile);
		pendingFile.release();
		const outdatedLoaded = await pending;

		expect(loaded).toBe(true);
		expect(outdatedLoaded).toBe(false);
		expect(store.sttFile()).toBe(sttFile);
		expect(store.sttData()?.recordTypes.get(1)?.name).toBe('Reading');
		expect(store.timeJotData()).toBeNull();
		expect(store.timeJotFile()).toBeNull();
	});

	test.each(['stt', 'timejot'] as const)('stays empty when sources are cleared during a pending %s upload', async source => {
		const original = source === 'stt' ? sttFile : timeJotFile;
		const pendingFile = new GatedFile([original], 'pending-upload');

		const pending = source === 'stt' ? store.loadSttFile(pendingFile) : store.loadTimeJotFile(pendingFile);
		store.clearSources();
		pendingFile.release();
		const loaded = await pending;

		expect(loaded).toBe(false);
		expect(store.sttData()).toBeNull();
		expect(store.sttFile()).toBeNull();
		expect(store.timeJotData()).toBeNull();
		expect(store.timeJotFile()).toBeNull();
	});

	test('clears source state when a corrupt TimeJot upload fails', async () => {
		await store.loadTimeJotFile(timeJotFile);
		const corruptFile = new File(['not a SQLite database'], 'broken.db');

		const loaded = await store.loadTimeJotFile(corruptFile);

		expect(loaded).toBe(false);
		expect(store.timeJotData()).toBeNull();
		expect(store.timeJotFile()).toBeNull();
	});

	test('preserves the newer source when an outdated corrupt upload fails', async () => {
		const corruptFile = new GatedFile(['not a SQLite database'], 'broken.db');

		const pending = store.loadTimeJotFile(corruptFile);
		await store.loadTimeJotFile(timeJotFile);
		corruptFile.release();
		const loaded = await pending;

		expect(loaded).toBe(false);
		expect(store.timeJotFile()).toBe(timeJotFile);
		expect(store.timeJotData()?.events.get(1)?.title).toBe('Reading');
	});

	test('closes the previous database when a valid target replaces it', async () => {
		await store.loadUHabitsFile(habitsFile);
		const previousDb = store.uhabitsData()!.db;
		const replacement = new File([habitsFile], 'replacement.db');

		const loaded = await store.loadUHabitsFile(replacement);

		expect(loaded).toBe(true);
		expect(store.uhabitsFile()).toBe(replacement);
		expect(store.uhabitsData()?.allHabits.get(1)?.name).toBe('Read');
		expect(() => previousDb.exec('SELECT 1')).toThrow();
		expect(store.uhabitsData()!.db.exec('SELECT COUNT(*) FROM Habits')[0].values).toEqual([[1]]);
	});

	test('closes and clears the previous target when a replacement is corrupt', async () => {
		await store.loadUHabitsFile(habitsFile);
		const previousDb = store.uhabitsData()!.db;
		const corruptFile = new File(['not a SQLite database'], 'broken.db');

		const loaded = await store.loadUHabitsFile(corruptFile);

		expect(loaded).toBe(false);
		expect(store.uhabitsData()).toBeNull();
		expect(store.uhabitsFile()).toBeNull();
		expect(() => previousDb.exec('SELECT 1')).toThrow();
	});

	test.each([false, true])('preserves the newer target when an outdated upload finishes (corrupt: %s)', async corrupt => {
		await store.loadUHabitsFile(habitsFile);
		const previousDb = store.uhabitsData()!.db;
		const pendingFile = new GatedFile([corrupt ? 'broken database' : habitsFile], 'older.db');
		const replacement = new File([habitsFile], 'newer.db');

		const pending = store.loadUHabitsFile(pendingFile);
		const loaded = await store.loadUHabitsFile(replacement);
		pendingFile.release();
		const outdatedLoaded = await pending;

		expect(loaded).toBe(true);
		expect(outdatedLoaded).toBe(false);
		expect(store.uhabitsFile()).toBe(replacement);
		expect(store.uhabitsData()!.db.exec('SELECT COUNT(*) FROM Habits')[0].values).toEqual([[1]]);
		expect(() => previousDb.exec('SELECT 1')).toThrow();
	});

	test.each([false, true])('stays empty when the target is cleared during an upload (corrupt: %s)', async corrupt => {
		await store.loadUHabitsFile(habitsFile);
		const previousDb = store.uhabitsData()!.db;
		const pendingFile = new GatedFile([corrupt ? 'broken database' : habitsFile], 'pending.db');

		const pending = store.loadUHabitsFile(pendingFile);
		store.clearUHabits();
		pendingFile.release();
		const loaded = await pending;

		expect(loaded).toBe(false);
		expect(store.uhabitsData()).toBeNull();
		expect(store.uhabitsFile()).toBeNull();
		expect(() => previousDb.exec('SELECT 1')).toThrow();
	});

	test('returns to the initial state when repeated upload and clear cycles finish', async () => {
		const cycleCount = 12;

		for (let cycle = 0; cycle < cycleCount; cycle++) {
			await store.loadSttFile(sttFile);
			await store.loadTimeJotFile(timeJotFile);
			await store.loadUHabitsFile(habitsFile);
			store.clearSources();
			store.clearUHabits();
		}

		expect(store.sttData()).toBeNull();
		expect(store.timeJotData()).toBeNull();
		expect(store.uhabitsData()).toBeNull();
		expect(store.sttFile()).toBeNull();
		expect(store.timeJotFile()).toBeNull();
		expect(store.uhabitsFile()).toBeNull();
	});
});

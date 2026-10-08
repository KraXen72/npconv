import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { afterEach, beforeAll, beforeEach } from 'vitest';
import { getUHabitsDb, habits, repetitions } from '../../src/db/uhabitsTables';

/** Track real databases opened by each test and the app, and always release them. */
export function useSqlite() {
	let initializedSQL: SqlJsStatic;
	let SQL: SqlJsStatic;
	let databases: Database[];

	beforeAll(async () => {
		initializedSQL = await initSqlJs();
	});
	beforeEach(() => {
		databases = [];
		SQL = {
			...initializedSQL,
			// Keep the real SQLite implementation; record ownership for cleanup
			// and for tests that verify the app releases databases before returning.
			Database: class extends initializedSQL.Database {
				constructor(...args: ConstructorParameters<SqlJsStatic['Database']>) {
					super(...args);
					databases.push(this);
				}
			}
		};
	});
	afterEach(() => {
		for (const db of databases) db.close();
	});

	return {
		get databases(): readonly Database[] { return databases; },
		get SQL() { return SQL; },
		open(bytes?: Uint8Array) {
			return new SQL.Database(bytes);
		}
	};
}

/** Use a real File with its own byte buffer, rather than a partial File cast. */
export function sqliteFile(bytes: Uint8Array, name = 'habits.db'): File {
	return new File([Uint8Array.from(bytes).buffer], name, { type: 'application/x-sqlite3' });
}

/** Create the Loop backup tables shared by the habit conversion regression tests. */
export function createHabitTables(db: Database): void {
	db.run(`CREATE TABLE Habits (
		id INTEGER PRIMARY KEY, archived INTEGER NOT NULL, color INTEGER NOT NULL, description TEXT,
		freq_den INTEGER NOT NULL, freq_num INTEGER NOT NULL, highlight INTEGER NOT NULL, name TEXT NOT NULL,
		position INTEGER NOT NULL, reminder_hour INTEGER, reminder_min INTEGER,
		reminder_days INTEGER, type INTEGER NOT NULL, target_type INTEGER NOT NULL,
		target_value REAL NOT NULL, unit TEXT NOT NULL, question TEXT NOT NULL, uuid TEXT)`);
	db.run(`CREATE TABLE Repetitions (
		id INTEGER PRIMARY KEY AUTOINCREMENT, habit INTEGER NOT NULL, timestamp INTEGER NOT NULL,
		value INTEGER NOT NULL, notes TEXT)`);
}

/** Seed a habit using the application's database type, with valid metadata defaults. */
export function addHabit(db: Database, id: number, name: string, type: number, unit = ''): void {
	getUHabitsDb(db).insert(habits).values({
		id, name, type, unit, archived: 0, color: 1, description: null,
		freqDen: 1, freqNum: 1, highlight: 0, position: id,
		reminderHour: null, reminderMin: null, reminderDays: null,
		targetType: 0, targetValue: 1, question: `${name}?`, uuid: null
	}).run();
}

/** Seed existing history without duplicating the repetition's data shape. */
export function addRepetition(db: Database, row: typeof repetitions.$inferInsert): void {
	getUHabitsDb(db).insert(repetitions).values(row).run();
}

/** Create TimeJot's export tables; each test supplies its own events and entries. */
export function createTimeJotTables(db: Database): void {
	db.run(`CREATE TABLE events (
		event_id INTEGER PRIMARY KEY, title TEXT NOT NULL, archived INTEGER NOT NULL)`);
	db.run(`CREATE TABLE entries (
		entry_id INTEGER PRIMARY KEY, note TEXT, fk_event_id INTEGER NOT NULL,
		creation_date TEXT NOT NULL, ongoing INTEGER NOT NULL)`);
}

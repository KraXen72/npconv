import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { afterEach, beforeAll, beforeEach } from 'vitest';
export { addHabit, addRepetition, createHabitTables } from './habits';

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

/** Create TimeJot's export tables; each test supplies its own events and entries. */
export function createTimeJotTables(db: Database): void {
	db.run(`CREATE TABLE events (
		event_id INTEGER PRIMARY KEY, title TEXT NOT NULL, archived INTEGER NOT NULL)`);
	db.run(`CREATE TABLE entries (
		entry_id INTEGER PRIMARY KEY, note TEXT, fk_event_id INTEGER NOT NULL,
		creation_date TEXT NOT NULL, ongoing INTEGER NOT NULL)`);
}

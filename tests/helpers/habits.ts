import type { Database } from 'sql.js';
import { getUHabitsDb, habits, repetitions } from '../../src/db/uhabitsTables';

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
export function addHabit(
  db: Database,
  id: number,
  name: string,
  type: number,
  unit = '',
  targetValue = 1
): void {
  getUHabitsDb(db)
    .insert(habits)
    .values({
      id,
      name,
      type,
      unit,
      archived: 0,
      color: 1,
      description: null,
      freqDen: 1,
      freqNum: 1,
      highlight: 0,
      position: id,
      reminderHour: null,
      reminderMin: null,
      reminderDays: null,
      targetType: 0,
      targetValue,
      question: `${name}?`,
      uuid: null,
    })
    .run();
}

/** Seed existing history without duplicating the repetition's data shape. */
export function addRepetition(db: Database, row: typeof repetitions.$inferInsert): void {
  getUHabitsDb(db).insert(repetitions).values(row).run();
}

import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Database } from 'sql.js';

export const habits = sqliteTable('Habits', {
	id: integer('id').primaryKey().notNull(),
	archived: integer('archived').notNull(),
	color: integer('color').notNull(),
	description: text('description'),
	freqDen: integer('freq_den').notNull(),
	freqNum: integer('freq_num').notNull(),
	highlight: integer('highlight').notNull(),
	name: text('name').notNull(),
	position: integer('position').notNull(),
	reminderHour: integer('reminder_hour').notNull(),
	reminderMin: integer('reminder_min').notNull(),
	reminderDays: integer('reminder_days').notNull(),
	type: integer('type').notNull(),
	targetType: integer('target_type').notNull(),
	targetValue: real('target_value').notNull(),
	unit: text('unit').notNull(),
	question: text('question').notNull(),
	uuid: text('uuid')
});

export const repetitions = sqliteTable('Repetitions', {
	id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
	habitId: integer('habit')
		.notNull()
		.references(() => habits.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
	timestamp: integer('timestamp').notNull(),
	value: integer('value').notNull(),
	notes: text('notes')
});

export const uHabitsSchema = {
	habits,
	repetitions
};

export type UHabitsDb = SQLJsDatabase<typeof uHabitsSchema>;

const dbCache = new WeakMap<Database, UHabitsDb>();

export function getUHabitsDb(db: Database): UHabitsDb {
	const cached = dbCache.get(db);
	if (cached) return cached;

	const orm = drizzle(db, { schema: uHabitsSchema });
	dbCache.set(db, orm);
	return orm;
}

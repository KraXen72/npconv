import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Database } from 'sql.js';

export const timeJotEvents = sqliteTable('events', {
	id: integer('event_id').primaryKey().notNull(),
	title: text('title').notNull(),
	archived: integer('archived').notNull()
});

export const timeJotEntries = sqliteTable('entries', {
	id: integer('entry_id').primaryKey().notNull(),
	note: text('note'),
	eventId: integer('fk_event_id').notNull(),
	creationDate: text('creation_date').notNull(),
	ongoing: integer('ongoing').notNull()
});

export const timeJotSchema = {
	events: timeJotEvents,
	entries: timeJotEntries
};

export type TimeJotDb = SQLJsDatabase<typeof timeJotSchema>;

const dbCache = new WeakMap<Database, TimeJotDb>();

export function getTimeJotDb(db: Database): TimeJotDb {
	const cached = dbCache.get(db);
	if (cached) return cached;

	const orm = drizzle(db, { schema: timeJotSchema });
	dbCache.set(db, orm);
	return orm;
}

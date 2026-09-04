import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from 'sql.js';
import * as v from 'valibot';
import { parseWithSchema } from '../schemas/sql';
import { TimeJotEventSchema, type TimeJotEvent } from '../schemas/timejot';
import { getTimeJotDb, timeJotEntries, timeJotEvents } from './timejotTables';

const RawTimeJotEntrySchema = v.object({
	id: v.number(),
	eventId: v.number(),
	date: v.string(),
	note: v.nullable(v.string())
});

export type RawTimeJotEntry = v.InferOutput<typeof RawTimeJotEntrySchema>;

export function selectTimeJotEvents(db: Database): TimeJotEvent[] {
	return getTimeJotDb(db)
		.select({
			id: timeJotEvents.id,
			title: timeJotEvents.title,
			archived: timeJotEvents.archived
		})
		.from(timeJotEvents)
		.orderBy(asc(timeJotEvents.archived), asc(sql`${timeJotEvents.title} COLLATE NOCASE`))
		.all()
		.map((row) => parseWithSchema(TimeJotEventSchema, row, 'TimeJot event row'));
}

export function selectCompletedTimeJotEntries(db: Database): RawTimeJotEntry[] {
	return getTimeJotDb(db)
		.select({
			id: timeJotEntries.id,
			eventId: timeJotEntries.eventId,
			date: timeJotEntries.creationDate,
			note: timeJotEntries.note
		})
		.from(timeJotEntries)
		.where(eq(timeJotEntries.ongoing, 0))
		.orderBy(asc(timeJotEntries.creationDate))
		.all()
		.map((row) => parseWithSchema(RawTimeJotEntrySchema, row, 'TimeJot entry row'));
}

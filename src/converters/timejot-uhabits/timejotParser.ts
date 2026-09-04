import type { SqlJsStatic } from 'sql.js';
import * as v from 'valibot';
import { selectRows } from '../../db/sqljs';
import { log } from '../../logger';
import {
	TimeJotEntrySchema,
	TimeJotEventSchema,
	type ParsedTimeJotBackup,
	type TimeJotEvent
} from '../../schemas/timejot';

const RawEntrySchema = v.object({
	id: v.number(),
	eventId: v.number(),
	date: v.string(),
	note: v.nullable(v.string())
});

export async function parseTimeJotBackup(file: File, SQL: SqlJsStatic): Promise<ParsedTimeJotBackup> {
	log('Parsing TimeJot export...', 'info');
	const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));

	try {
		const eventRows = selectRows(db, `
			SELECT event_id AS id, title, archived
			FROM events
			ORDER BY archived, title COLLATE NOCASE
		`, TimeJotEventSchema);
		const events = new Map<number, TimeJotEvent>(eventRows.map(event => [event.id, event]));

		const rawEntries = selectRows(db, `
			SELECT entry_id AS id, fk_event_id AS eventId, creation_date AS date, note
			FROM entries
			WHERE ongoing = 0
			ORDER BY creation_date
		`, RawEntrySchema);
		const entries = rawEntries.flatMap(row => {
			const match = /^(\d{4}-\d{2}-\d{2})/.exec(row.date);
			if (!match) {
				log(`Skipping TimeJot entry ${row.id}: invalid date ${row.date}`, 'warn');
				return [];
			}
			return [v.parse(TimeJotEntrySchema, { ...row, dayKey: match[1] })];
		});

		log(`Loaded ${events.size} TimeJot events and ${entries.length} entries`, 'info');
		return { events, entries };
	} finally {
		db.close();
	}
}

import type { SqlJsStatic } from 'sql.js';
import * as v from 'valibot';
import { selectCompletedTimeJotEntries, selectTimeJotEvents } from '../../db/timejotRepo';
import { log } from '../../logger';
import {
	TimeJotEntrySchema,
	type ParsedTimeJotBackup,
	type TimeJotEvent
} from '../../schemas/timejot';

export async function parseTimeJotBackup(file: File, SQL: SqlJsStatic): Promise<ParsedTimeJotBackup> {
	log('Parsing TimeJot export...', 'info');
	const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));

	try {
		const eventRows = selectTimeJotEvents(db);
		const events = new Map<number, TimeJotEvent>(eventRows.map(event => [event.id, event]));
		const rawEntries = selectCompletedTimeJotEntries(db);
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

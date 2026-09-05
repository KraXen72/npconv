import type { SqlJsStatic } from 'sql.js';
import * as v from 'valibot';
import { selectCompletedTimeJotEntries, selectTimeJotEvents } from '../../db/timejotRepo';
import { log } from '../../logger';
import {
	TimeJotEntrySchema,
	type ParsedTimeJotBackup,
	type TimeJotEvent
} from '../../schemas/timejot';
import { dayKeyToTimestamp, timestampToDayKey } from '../stt-uhabits/uhabitsHelper';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a TimeJot timestamp to the Loop calendar day it should count
 * toward, optionally treating early-morning entries as part of the previous
 * day. The clock time is read from the timestamp itself, so the rule follows
 * the user's local TimeJot date rather than the browser's timezone.
 */
export function timeJotDayKey(date: string, rolloverHours = 0): string {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(date);
	if (!match) return date.slice(0, 10);

	const normalizedHours = Number.isFinite(rolloverHours)
		? Math.max(0, Math.min(24, Math.floor(rolloverHours)))
		: 0;
	if (Number(match[2]) >= normalizedHours) return match[1];

	return timestampToDayKey(dayKeyToTimestamp(match[1]) - DAY_MS);
}

/**
 * Return positive days for an inverted TimeJot event.
 *
 * When the target habit has enough history, inversion is limited to the
 * largest gap between two existing uHabits days that contains a source day.
 * This prevents a long-lived TimeJot event from synthesizing repetitions over
 * years when the target habit was only temporarily untracked. With fewer than
 * two target days there is no bounded gap to infer, so the source range remains
 * the conservative fallback for backwards-compatible previews and imports.
 */
export function invertTimeJotDays(
	dayKeys: Iterable<string>,
	existingUHabitsDays: Iterable<string> = []
): Set<string> {
	const recordedDays = new Set(dayKeys);
	const sortedRecordedDays = [...recordedDays].sort();
	if (sortedRecordedDays.length === 0) return new Set();

	let firstDay = dayKeyToTimestamp(sortedRecordedDays[0]);
	let lastDay = dayKeyToTimestamp(sortedRecordedDays[sortedRecordedDays.length - 1]);
	const sortedExistingDays = [...new Set(existingUHabitsDays)].sort();

	if (sortedExistingDays.length >= 2) {
		let bestGap: { firstDay: number; lastDay: number; length: number } | undefined;

		for (let index = 1; index < sortedExistingDays.length; index++) {
			const gapFirstDay = dayKeyToTimestamp(sortedExistingDays[index - 1]) + DAY_MS;
			const gapLastDay = dayKeyToTimestamp(sortedExistingDays[index]) - DAY_MS;
			if (gapFirstDay > gapLastDay) continue;

			const containsRecordedDay = sortedRecordedDays.some(dayKey => {
				const timestamp = dayKeyToTimestamp(dayKey);
				return timestamp >= gapFirstDay && timestamp <= gapLastDay;
			});
			if (!containsRecordedDay) continue;

			const length = Math.round((gapLastDay - gapFirstDay) / DAY_MS) + 1;
			if (!bestGap || length > bestGap.length) {
				bestGap = { firstDay: gapFirstDay, lastDay: gapLastDay, length };
			}
		}

		// Existing target history gives us a boundary, but no matching gap means
		// there is no safe place to invent positive days.
		if (!bestGap) return new Set();
		firstDay = bestGap.firstDay;
		lastDay = bestGap.lastDay;
	}

	const invertedDays = new Set<string>();

	for (let timestamp = firstDay; timestamp <= lastDay; timestamp += DAY_MS) {
		const dayKey = timestampToDayKey(timestamp);
		if (!recordedDays.has(dayKey)) invertedDays.add(dayKey);
	}

	return invertedDays;
}

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

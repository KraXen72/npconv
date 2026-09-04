import type { Database } from 'sql.js';
import type { ConversionMapping, ParsedUHabitsBackup } from '../../schemas/uhabits';
import { insertRepetition } from '../../db/uhabitsRepo';
import { dayKeyToTimestamp, timestampToDayKey } from '../stt-uhabits/uhabitsHelper';
import { log } from '../../logger';

export interface SourceDay {
	dayKey: string;
	notes: string[];
}

export interface ResolvedMapping {
	label: string;
	days: SourceDay[];
}

interface PendingRepetition {
	habitId: number;
	timestamp: number;
	value: number;
	notes: Set<string>;
}

export function importMappedDays(
	db: Database,
	uhabits: ParsedUHabitsBackup,
	mappings: ConversionMapping[],
	resolve: (mapping: ConversionMapping) => ResolvedMapping | null
): number {
	const existing = new Set(uhabits.repetitions.map(rep => `${rep.habit_id}:${timestampToDayKey(rep.timestamp)}`));
	const pending = new Map<string, PendingRepetition>();

	for (const mapping of mappings) {
		const target = uhabits.allHabits.get(mapping.uhabitsHabitId);
		const source = resolve(mapping);
		if (!target || !source || (target.type !== 0 && target.type !== 1)) {
			log('Skipping invalid source → habit mapping', 'warn');
			continue;
		}

		const numericValue = mapping.numericValue ?? 1;
		if (target.type === 1 && (!Number.isFinite(numericValue) || numericValue <= 0)) {
			log(`Skipping "${source.label}" → "${target.name}": numeric value must be greater than zero`, 'warn');
			continue;
		}

		const uniqueDays = new Map<string, Set<string>>();
		for (const day of source.days) {
			const notes = uniqueDays.get(day.dayKey) ?? new Set<string>();
			if (mapping.copySourceNotes) day.notes.filter(Boolean).forEach(note => notes.add(note));
			uniqueDays.set(day.dayKey, notes);
		}

		let added = 0;
		let overlap = 0;
		for (const [dayKey, notes] of uniqueDays) {
			const key = `${target.id}:${dayKey}`;
			if (existing.has(key)) {
				overlap++;
				continue;
			}

			const value = target.type === 0 ? 2 : Math.round(numericValue * 1000);
			const queued = pending.get(key);
			if (queued) {
				if (target.type === 1) queued.value += value;
				notes.forEach(note => queued.notes.add(note));
			} else {
				pending.set(key, {
					habitId: target.id,
					timestamp: dayKeyToTimestamp(dayKey),
					value,
					notes
				});
			}
			added++;
		}

		log(`"${source.label}" → "${target.name}": ${added} source days queued${overlap ? `, ${overlap} overlap skipped` : ''}`, 'info');
	}

	const rows = [...pending.values()].sort((a, b) => a.timestamp - b.timestamp || a.habitId - b.habitId);
	for (const row of rows) {
		insertRepetition(db, {
			habitId: row.habitId,
			timestamp: row.timestamp,
			value: row.value,
			notes: [...row.notes].join('; ')
		});
	}

	return rows.length;
}

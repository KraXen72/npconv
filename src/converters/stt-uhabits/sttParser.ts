import * as v from 'valibot';
import type { ParsedSttBackup, SttRecordType, SttRecord, SttCategory, SttRecordTag } from '../../schemas/stt';
import { log } from '../../logger';
import { SttCategorySchema, SttRecordSchema, SttRecordTagSchema, SttRecordTypeSchema } from '../../schemas/stt';

type SttRowType = 'recordType' | 'record' | 'category' | 'recordTag';

function parseSttRow<T>(schema: v.GenericSchema<unknown, T>, input: unknown, context: string, rawLine: string): T | undefined {
	const result = v.safeParse(schema, input);
	if (result.success) return result.output;

	log(`Skipping invalid ${context}: ${rawLine} (${v.summarize(result.issues)})`, 'warn');
	return undefined;
}

/**
 * Parse Simple Time Tracker TSV backup file
 */
export async function parseSttBackup(file: File): Promise<ParsedSttBackup> {
	log('Parsing STT backup file...', 'info');
	
	const text = await file.text();
	
	const recordTypes = new Map<number, SttRecordType>();
	const records: SttRecord[] = [];
	const categories = new Map<number, SttCategory>();
	const recordTags = new Map<number, SttRecordTag>();
	
	const lines = text.split('\n');
	let rowCount = 0;
	
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		
		const row = trimmed.split('\t');
		if (row.length === 0) continue;
		
		rowCount++;
		const type = row[0] as SttRowType;
		
		if (type === 'recordType') {
			// recordType\t1\tGuitar\t🎸\t2\t0\t0
			const recordType = parseSttRow(SttRecordTypeSchema, {
				id: parseInt(row[1], 10),
				name: row[2] || '',
				emoji: row[3] || '',
				color: parseInt(row[4], 10) || 0,
				category_id: parseInt(row[5], 10) || 0,
			}, 'STT recordType row', row.join('\t'));
			
			if (recordType) {
				recordTypes.set(recordType.id, recordType);
			}
			
		} else if (type === 'record') {
			// Current backups contain a legacy tag-id field at index 6. Comments
			// are stored only at index 5; joining the remaining columns turns an
			// empty comment plus an empty legacy field into a spurious tab note.
			let end_timestamp = parseInt(row[4], 10);
			
			// Handle malformed timestamps (e.g., ending with 'f')
			if (isNaN(end_timestamp)) {
				const endStr = row[4];
				if (endStr && endStr.endsWith('f')) {
					end_timestamp = parseInt(endStr.slice(0, -1), 10);
				}
			}
			
			const recordInput = {
				id: parseInt(row[1], 10),
				type_id: parseInt(row[2], 10),
				start_timestamp: parseInt(row[3], 10),
				end_timestamp,
				comment: row[5] || undefined,
			};
			
			const record = parseSttRow(SttRecordSchema, recordInput, 'STT record row', row.join('\t'));
			if (record) records.push(record);
			
		} else if (type === 'category') {
			// category\t1\t2 - Productive Hobbies\t9
			const category = parseSttRow(SttCategorySchema, {
				id: parseInt(row[1], 10),
				name: row[2] || '',
				color: parseInt(row[3], 10) || 0,
			}, 'STT category row', row.join('\t'));
			
			if (category) {
				categories.set(category.id, category);
			}
			
		} else if (type === 'recordTag') {
			// recordTag\t1\t\te-reader\t0\t0\t\t📓\t5\t\t0
			const recordTag = parseSttRow(SttRecordTagSchema, {
				id: parseInt(row[1], 10),
				name: row[3] || '',
				emoji: row[7] || '',
				color: parseInt(row[4], 10) || 0,
				type_id: parseInt(row[5], 10) || 0,
			}, 'STT recordTag row', row.join('\t'));
			
			if (recordTag) {
				recordTags.set(recordTag.id, recordTag);
			}
		}
		// Ignore other line types (typeCategory, recordToRecordTag, prefs, etc.)
	}
	
	log(`Parsed ${recordTypes.size} record types, ${records.length} records (${rowCount} rows total)`, 'info');
	return { recordTypes, records, categories, recordTags };
}

/**
 * Filter records by minimum duration in minutes
 */
export function filterRecordsByDuration(records: SttRecord[], minMinutes: number): SttRecord[] {
	if (minMinutes <= 0) return records;
	
	const minMs = minMinutes * 60 * 1000;
	return records.filter(record => {
		const duration = record.end_timestamp - record.start_timestamp;
		return duration >= minMs;
	});
}

/**
 * Group records by calendar day (YYYY-MM-DD format)
 */
export function groupRecordsByDay(records: SttRecord[]): Map<string, SttRecord[]> {
	const groups = new Map<string, SttRecord[]>();
	
	for (const record of records) {
		const date = new Date(record.start_timestamp);
		const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
		
		if (!groups.has(dayKey)) {
			groups.set(dayKey, []);
		}
		groups.get(dayKey)!.push(record);
	}
	
	return groups;
}

/**
 * Get all records for a specific activity type
 */
export function getRecordsForType(records: SttRecord[], typeId: number): SttRecord[] {
	return records.filter(record => record.type_id === typeId);
}
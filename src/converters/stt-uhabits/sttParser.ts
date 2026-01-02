import type { ParsedSttBackup, SttRecordType, SttRecord, SttCategory, SttRecordTag } from '../../types/stt';
import { log } from '../../logger';

/**
 * Parse Simple Time Tracker TSV backup file
 */
export async function parseSttBackup(file: File): Promise<ParsedSttBackup> {
	log('Parsing STT backup file...', 'info');
	
	const text = await file.text();
	const lines = text.split('\n').filter(line => line.trim());
	
	const recordTypes = new Map<number, SttRecordType>();
	const records: SttRecord[] = [];
	const categories = new Map<number, SttCategory>();
	const recordTags = new Map<number, SttRecordTag>();
	
	for (const line of lines) {
		const parts = line.split('\t');
		const type = parts[0];
		
		if (type === 'recordType') {
			// recordType	1	Guitar	🎸	2	0	0
			const id = parseInt(parts[1]);
			const name = parts[2] || '';
			const emoji = parts[3] || '';
			const color = parseInt(parts[4]) || 0;
			const category_id = parseInt(parts[5]) || 0;
			
			recordTypes.set(id, { id, name, emoji, color, category_id });
			
		} else if (type === 'record') {
			// record	4	3	1691576017000	1691584365000	Fireship sveltekit course kung.foo
			const id = parseInt(parts[1]);
			const type_id = parseInt(parts[2]);
			const start_timestamp = parseInt(parts[3]);
			let end_timestamp = parseInt(parts[4]);
			const comment = parts.slice(5).join('\t'); // rejoin in case comment has tabs
			
			// Handle malformed timestamps (e.g., ending with 'f')
			if (isNaN(end_timestamp)) {
				const endStr = parts[4];
				if (endStr && endStr.endsWith('f')) {
					end_timestamp = parseInt(endStr.slice(0, -1));
				}
			}
			
			// Skip invalid records
			if (isNaN(id) || isNaN(type_id) || isNaN(start_timestamp) || isNaN(end_timestamp)) {
				log(`Skipping invalid record: ${line}`, 'warn');
				continue;
			}
			
			records.push({
				id,
				type_id,
				start_timestamp,
				end_timestamp,
				comment: comment || undefined
			});
			
		} else if (type === 'category') {
			// category	1	2 - Productive Hobbies	9
			const id = parseInt(parts[1]);
			const name = parts[2] || '';
			const color = parseInt(parts[3]) || 0;
			
			categories.set(id, { id, name, color });
			
		} else if (type === 'recordTag') {
			// recordTag	1		e-reader	0	0		📓	5		0
			const id = parseInt(parts[1]);
			const name = parts[3] || '';
			const color = parseInt(parts[4]) || 0;
			const type_id = parseInt(parts[5]) || 0;
			const emoji = parts[7] || '';
			
			recordTags.set(id, { id, name, emoji, color, type_id });
		}
		// Ignore other line types (typeCategory, recordToRecordTag, prefs, etc.)
	}
	
	log(`Parsed ${recordTypes.size} record types, ${records.length} records`, 'info');
	
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

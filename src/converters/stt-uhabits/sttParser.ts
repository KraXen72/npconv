import { parseString } from '@fast-csv/parse';
import type { ParsedSttBackup, SttRecordType, SttRecord, SttCategory, SttRecordTag } from '../../types/stt';
import { log } from '../../logger';

type SttRowType = 'recordType' | 'record' | 'category' | 'recordTag';

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
	
	return new Promise<ParsedSttBackup>((resolve, reject) => {
		parseString(text, {
			delimiter: '\t',
			headers: false,
			ignoreEmpty: true,
		})
		.on('data', (row: string[]) => {
			if (row.length === 0) return;
			
			const type = row[0] as SttRowType;
			
			if (type === 'recordType') {
				// recordType	1	Guitar	🎸	2	0	0
				const recordType: SttRecordType = {
					id: parseInt(row[1], 10),
					name: row[2] || '',
					emoji: row[3] || '',
					color: parseInt(row[4], 10) || 0,
					category_id: parseInt(row[5], 10) || 0,
				};
				
				if (!isNaN(recordType.id)) {
					recordTypes.set(recordType.id, recordType);
				}
				
			} else if (type === 'record') {
				// record	4	3	1691576017000	1691584365000	Fireship sveltekit course kung.foo
				let end_timestamp = parseInt(row[4], 10);
				
				// Handle malformed timestamps (e.g., ending with 'f')
				if (isNaN(end_timestamp)) {
					const endStr = row[4];
					if (endStr && endStr.endsWith('f')) {
						end_timestamp = parseInt(endStr.slice(0, -1), 10);
					}
				}
				
				const record: SttRecord = {
					id: parseInt(row[1], 10),
					type_id: parseInt(row[2], 10),
					start_timestamp: parseInt(row[3], 10),
					end_timestamp,
					comment: row.slice(5).join('\t') || undefined,
				};
				
				// Skip invalid records
				if (isNaN(record.id) || isNaN(record.type_id) || isNaN(record.start_timestamp) || isNaN(record.end_timestamp)) {
					log(`Skipping invalid record: ${row.join('\t')}`, 'warn');
					return;
				}
				
				records.push(record);
				
			} else if (type === 'category') {
				// category	1	2 - Productive Hobbies	9
				const category: SttCategory = {
					id: parseInt(row[1], 10),
					name: row[2] || '',
					color: parseInt(row[3], 10) || 0,
				};
				
				if (!isNaN(category.id)) {
					categories.set(category.id, category);
				}
				
			} else if (type === 'recordTag') {
				// recordTag	1		e-reader	0	0		📓	5		0
				const recordTag: SttRecordTag = {
					id: parseInt(row[1], 10),
					name: row[3] || '',
					emoji: row[7] || '',
					color: parseInt(row[4], 10) || 0,
					type_id: parseInt(row[5], 10) || 0,
				};
				
				if (!isNaN(recordTag.id)) {
					recordTags.set(recordTag.id, recordTag);
				}
			}
			// Ignore other line types (typeCategory, recordToRecordTag, prefs, etc.)
		})
		.on('error', (error: Error) => {
			log(`Error parsing STT backup: ${error.message}`, 'error');
			reject(error);
		})
		.on('end', (rowCount: number) => {
			log(`Parsed ${recordTypes.size} record types, ${records.length} records (${rowCount} rows total)`, 'info');
			resolve({ recordTypes, records, categories, recordTags });
		});
	});
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

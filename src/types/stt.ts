export interface SttRecordType {
	id: number;
	name: string;
	emoji: string;
	color: number;
	category_id: number;
}

export interface SttRecord {
	id: number;
	type_id: number;
	start_timestamp: number; // milliseconds
	end_timestamp: number; // milliseconds
	comment?: string;
}

export interface SttCategory {
	id: number;
	name: string;
	color: number;
}

export interface SttRecordTag {
	id: number;
	name: string;
	emoji: string;
	color: number;
	type_id: number;
}

export interface ParsedSttBackup {
	recordTypes: Map<number, SttRecordType>;
	records: SttRecord[];
	categories: Map<number, SttCategory>;
	recordTags: Map<number, SttRecordTag>;
}

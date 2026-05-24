import * as v from 'valibot';
import { IntegerSchema } from './sql';

export const SttRecordTypeSchema = v.object({
	id: IntegerSchema,
	name: v.string(),
	emoji: v.string(),
	color: IntegerSchema,
	category_id: IntegerSchema
});
export type SttRecordType = v.InferOutput<typeof SttRecordTypeSchema>;

export const SttRecordSchema = v.object({
	id: IntegerSchema,
	type_id: IntegerSchema,
	start_timestamp: IntegerSchema,
	end_timestamp: IntegerSchema,
	comment: v.optional(v.string())
});
export type SttRecord = v.InferOutput<typeof SttRecordSchema>;

export const SttCategorySchema = v.object({
	id: IntegerSchema,
	name: v.string(),
	color: IntegerSchema
});
export type SttCategory = v.InferOutput<typeof SttCategorySchema>;

export const SttRecordTagSchema = v.object({
	id: IntegerSchema,
	name: v.string(),
	emoji: v.string(),
	color: IntegerSchema,
	type_id: IntegerSchema
});
export type SttRecordTag = v.InferOutput<typeof SttRecordTagSchema>;

export interface ParsedSttBackup {
	recordTypes: Map<number, SttRecordType>;
	records: SttRecord[];
	categories: Map<number, SttCategory>;
	recordTags: Map<number, SttRecordTag>;
}

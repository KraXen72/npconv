import * as v from 'valibot';
import { IntegerSchema } from './sql';

export const TimeJotEventSchema = v.object({
	id: IntegerSchema,
	title: v.string(),
	archived: IntegerSchema
});
export type TimeJotEvent = v.InferOutput<typeof TimeJotEventSchema>;

export const TimeJotEntrySchema = v.object({
	id: IntegerSchema,
	eventId: IntegerSchema,
	date: v.string(),
	dayKey: v.string(),
	note: v.nullable(v.string())
});
export type TimeJotEntry = v.InferOutput<typeof TimeJotEntrySchema>;

export interface ParsedTimeJotBackup {
	events: Map<number, TimeJotEvent>;
	entries: TimeJotEntry[];
}

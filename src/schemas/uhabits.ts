import type { Database } from 'sql.js';
import * as v from 'valibot';
import { IntegerSchema } from './sql';

export const UHabitsHabitSchema = v.object({
	id: IntegerSchema,
	name: v.string(),
	question: v.string(),
	color: IntegerSchema,
	archived: IntegerSchema,
	type: IntegerSchema,
	freq_num: IntegerSchema,
	freq_den: IntegerSchema,
	position: IntegerSchema,
	highlight: IntegerSchema,
	reminder_hour: IntegerSchema,
	reminder_min: IntegerSchema,
	reminder_days: IntegerSchema,
	target_type: IntegerSchema,
	target_value: v.number(),
	unit: v.string(),
	description: v.optional(v.string()),
	uuid: v.optional(v.string())
});
export type UHabitsHabit = v.InferOutput<typeof UHabitsHabitSchema>;

export const UHabitsRepetitionSchema = v.object({
	id: IntegerSchema,
	habit_id: IntegerSchema,
	timestamp: IntegerSchema,
	value: IntegerSchema,
	notes: v.optional(v.string())
});
export type UHabitsRepetition = v.InferOutput<typeof UHabitsRepetitionSchema>;

export const UHabitsRepetitionInsertSchema = v.object({
	habitId: IntegerSchema,
	timestamp: IntegerSchema,
	value: IntegerSchema,
	notes: v.string()
});
export type UHabitsRepetitionInsert = v.InferOutput<typeof UHabitsRepetitionInsertSchema>;

export interface ParsedUHabitsBackup {
	db: Database;
	allHabits: Map<number, UHabitsHabit>;
	booleanHabits: Map<number, UHabitsHabit>;
	repetitions: UHabitsRepetition[];
}

export const ConversionMappingSchema = v.object({
	sttTypeId: IntegerSchema,
	uhabitsHabitId: IntegerSchema,
	minDuration: v.optional(v.number()),
	copySttComments: v.optional(v.boolean())
});
export type ConversionMapping = v.InferOutput<typeof ConversionMappingSchema>;

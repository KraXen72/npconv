import type { Database } from 'sql.js';
import * as v from 'valibot';
import { createInsertSchema, createSelectSchema } from 'drizzle-valibot';
import { habits, repetitions } from '../db/uhabitsTables';
import { IntegerSchema } from './sql';

const integerColumn = () => IntegerSchema;
const nullableIntegerColumn = () => v.nullable(IntegerSchema);

// A disabled Loop reminder is represented by NULL. The converter does not use
// reminder metadata, so normalize it to zero for a predictable parsed shape.
const reminderInteger = () => v.nullish(IntegerSchema, 0);

export type UHabitsHabitDb = typeof habits.$inferSelect;
export type UHabitsRepetitionDb = typeof repetitions.$inferSelect;
export type UHabitsRepetitionInsert = Pick<UHabitsRepetitionDb, 'habitId' | 'timestamp' | 'value' | 'notes'>;

export type UHabitsHabit = Pick<UHabitsHabitDb, 'id' | 'name' | 'question' | 'color' | 'archived' | 'type' | 'position' | 'highlight' | 'unit' | 'description' | 'uuid'> & {
	freq_num: UHabitsHabitDb['freqNum'];
	freq_den: UHabitsHabitDb['freqDen'];
	reminder_hour: UHabitsHabitDb['reminderHour'];
	reminder_min: UHabitsHabitDb['reminderMin'];
	reminder_days: UHabitsHabitDb['reminderDays'];
	target_type: UHabitsHabitDb['targetType'];
	target_value: UHabitsHabitDb['targetValue'];
};

export type UHabitsRepetition = Pick<UHabitsRepetitionDb, 'id' | 'timestamp' | 'value' | 'notes'> & {
	habit_id: UHabitsRepetitionDb['habitId'];
};

export const UHabitsHabitDbSchema = createSelectSchema(habits, {
	id: integerColumn,
	archived: integerColumn,
	color: integerColumn,
	freqDen: integerColumn,
	freqNum: integerColumn,
	highlight: integerColumn,
	position: integerColumn,
	reminderHour: nullableIntegerColumn,
	reminderMin: nullableIntegerColumn,
	reminderDays: nullableIntegerColumn,
	type: integerColumn,
	targetType: integerColumn
});

export const UHabitsHabitSchema: v.GenericSchema<unknown, UHabitsHabit> = v.object({
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
	reminder_hour: reminderInteger(),
	reminder_min: reminderInteger(),
	reminder_days: reminderInteger(),
	target_type: IntegerSchema,
	target_value: v.number(),
	unit: v.string(),
	description: v.nullable(v.string()),
	uuid: v.nullable(v.string())
});

export const UHabitsRepetitionDbSchema = createSelectSchema(repetitions, {
	id: integerColumn,
	habitId: integerColumn,
	timestamp: integerColumn,
	value: integerColumn
});

export const UHabitsRepetitionSchema: v.GenericSchema<unknown, UHabitsRepetition> = v.object({
	id: IntegerSchema,
	habit_id: IntegerSchema,
	timestamp: IntegerSchema,
	value: IntegerSchema,
	notes: v.nullable(v.string())
});

export const UHabitsRepetitionInsertSchema: v.GenericSchema<unknown, UHabitsRepetitionInsert> = v.pick(createSelectSchema(repetitions, {
	habitId: integerColumn,
	timestamp: integerColumn,
	value: integerColumn
}), ['habitId', 'timestamp', 'value', 'notes']);

export interface ParsedUHabitsBackup {
	db: Database;
	allHabits: Map<number, UHabitsHabit>;
	booleanHabits: Map<number, UHabitsHabit>;
	numericHabits: Map<number, UHabitsHabit>;
	repetitions: UHabitsRepetition[];
}

export const ConversionMappingSchema = v.object({
	sourceId: IntegerSchema,
	uhabitsHabitId: IntegerSchema,
	minDuration: v.optional(v.number()),
	copySourceNotes: v.optional(v.boolean()),
	numericValue: v.optional(v.number())
});
export type ConversionMapping = v.InferOutput<typeof ConversionMappingSchema>;

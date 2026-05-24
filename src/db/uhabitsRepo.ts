import type { Database } from 'sql.js';
import { parseWithSchema } from '../schemas/sql';
import { getUHabitsDb, habits, repetitions } from './uhabitsTables';
import {
	UHabitsHabitSchema,
	UHabitsRepetitionInsertSchema,
	UHabitsRepetitionSchema,
	type UHabitsHabit,
	type UHabitsRepetition,
	type UHabitsRepetitionInsert
} from '../schemas/uhabits';

export function selectHabits(db: Database): UHabitsHabit[] {
	return getUHabitsDb(db)
		.select({
			id: habits.id,
			archived: habits.archived,
			color: habits.color,
			description: habits.description,
			freq_den: habits.freqDen,
			freq_num: habits.freqNum,
			highlight: habits.highlight,
			name: habits.name,
			position: habits.position,
			reminder_hour: habits.reminderHour,
			reminder_min: habits.reminderMin,
			reminder_days: habits.reminderDays,
			type: habits.type,
			target_type: habits.targetType,
			target_value: habits.targetValue,
			unit: habits.unit,
			question: habits.question,
			uuid: habits.uuid
		})
		.from(habits)
		.all()
		.map((row) => parseWithSchema(UHabitsHabitSchema, row, 'uHabits habit row'));
}

export function selectRepetitions(db: Database): UHabitsRepetition[] {
	return getUHabitsDb(db)
		.select({
			id: repetitions.id,
			habit_id: repetitions.habitId,
			timestamp: repetitions.timestamp,
			value: repetitions.value,
			notes: repetitions.notes
		})
		.from(repetitions)
		.all()
		.map((row) => parseWithSchema(UHabitsRepetitionSchema, row, 'uHabits repetition row'));
}

export function insertRepetition(db: Database, input: UHabitsRepetitionInsert): void {
	const row = parseWithSchema(UHabitsRepetitionInsertSchema, input, 'uHabits repetition insert');
	getUHabitsDb(db).insert(repetitions).values(row).run();
}

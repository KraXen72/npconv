import type { Database } from 'sql.js';
import { selectRows, validatePayload } from './sqljs';
import {
	UHabitsHabitSchema,
	UHabitsRepetitionInsertSchema,
	UHabitsRepetitionSchema,
	type UHabitsHabit,
	type UHabitsRepetition,
	type UHabitsRepetitionInsert
} from '../schemas/uhabits';

export function selectHabits(db: Database): UHabitsHabit[] {
	const rows = selectRows(
		db,
		`
			SELECT id, archived, color, description, freq_den, freq_num, highlight,
			       name, position, reminder_hour, reminder_min, reminder_days,
			       type, target_type, target_value, unit, question, uuid
			FROM Habits
		`,
		UHabitsHabitSchema
	);
	return rows;
}

export function selectRepetitions(db: Database): UHabitsRepetition[] {
	return selectRows(
		db,
		'SELECT id, habit AS habit_id, timestamp, value, notes FROM Repetitions',
		UHabitsRepetitionSchema
	);
}

export function insertRepetition(db: Database, input: UHabitsRepetitionInsert): void {
	const row = validatePayload(UHabitsRepetitionInsertSchema, input, 'uHabits repetition insert');
	db.run(
		`
			INSERT INTO Repetitions (habit, timestamp, value, notes)
			VALUES (?, ?, ?, ?)
		`,
		[row.habitId, row.timestamp, row.value, row.notes]
	);
}

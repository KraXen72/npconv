export interface UHabitsHabit {
	id: number;
	name: string;
	question: string;
	color: number;
	archived: number;
	type: number; // 0 = boolean
	freq_num: number;
	freq_den: number;
	position: number;
	highlight: number;
	reminder_hour: number;
	reminder_min: number;
	reminder_days: number;
	target_type: number;
	target_value: number;
	unit: string;
	description?: string;
	uuid?: string;
}

export interface UHabitsRepetition {
	id: number;
	habit_id: number;
	timestamp: number; // milliseconds (midnight of day)
	value: number; // 0 = unchecked, 2 = checked
	notes?: string;
}

export interface ParsedUHabitsBackup {
	db: any; // sql.js Database instance
	allHabits: Map<number, UHabitsHabit>; // All habits including non-boolean
	booleanHabits: Map<number, UHabitsHabit>; // Only boolean habits (type=0) for UI
	repetitions: UHabitsRepetition[];
}

export interface ConversionMapping {
	sttTypeId: number;
	uhabitsHabitId: number;
	minDuration?: number;
	copySttComments?: boolean;
}

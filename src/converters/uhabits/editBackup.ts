import { and, eq } from 'drizzle-orm';
import type { Database, SqlJsStatic } from 'sql.js';
import { parseUHabitsBackup } from '../stt-uhabits/uhabitsHelper';
import { getUHabitsDb, habits, repetitions } from '../../db/uhabitsTables';
import type { ParsedUHabitsBackup, UHabitsHabit, UHabitsRepetition } from '../../schemas/uhabits';

/** Loop stores numerical amounts as signed 32-bit integers in thousandths. */
export const NUMERIC_VALUE_SCALE = 1000;
export const MIN_NUMERIC_VALUE = 1 / NUMERIC_VALUE_SCALE;
export const MAX_NUMERIC_VALUE = 2147483647 / NUMERIC_VALUE_SCALE;

export interface ConversionRule {
  threshold: number;
  comparison: 'at-least' | 'at-most';
  checkedValue: number;
}

interface DateRange {
  start?: string;
  end?: string;
}

interface HabitTransfer {
  sourceId: UHabitsHabit['id'];
  targetId: UHabitsHabit['id'];
  range: DateRange;
  overwrite: boolean;
}

export type HabitEdit =
  | ({
      kind: 'change-type';
      habitId: UHabitsHabit['id'];
      unit: string;
      targetValue: number;
    } & ConversionRule)
  | ({ kind: 'fill' } & HabitTransfer & ConversionRule)
  | ({ kind: 'copy'; range: Required<DateRange> } & HabitTransfer);

export type HabitHistoryEntry = Pick<UHabitsRepetition, 'timestamp' | 'value' | 'notes'>;

type PlannedEntry = HabitHistoryEntry & { sourceRepetitionId: UHabitsRepetition['id'] };

export interface HabitEditPlan {
  source: UHabitsHabit;
  target: UHabitsHabit;
  resultHabit: UHabitsHabit;
  sourceHistory: HabitHistoryEntry[];
  writes: PlannedEntry[];
  before: HabitHistoryEntry[];
  after: HabitHistoryEntry[];
  preserved: number;
}

export interface HabitEditResult {
  blob: Blob;
  changed: number;
  preserved: number;
}

/** Parse a UTC calendar day, rejecting invalid dates rather than normalizing them. */
export function parseHabitDate(value: string): number {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  const hasDateFormat = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const isExactDate =
    Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;

  if (!hasDateFormat || !isExactDate) {
    throw new Error('Enter a valid date in YYYY-MM-DD format.');
  }

  return timestamp;
}

/** Round a positive amount to Loop's thousandths and validate its signed 32-bit storage limit. */
function storedNumericValue(value: number): number {
  const stored = Math.round(value * NUMERIC_VALUE_SCALE);
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    stored < 1 ||
    stored > MAX_NUMERIC_VALUE * NUMERIC_VALUE_SCALE
  ) {
    throw new Error(
      `Numeric values must be positive and fit Loop’s range (${MIN_NUMERIC_VALUE}–${MAX_NUMERIC_VALUE}).`
    );
  }

  return stored;
}

function requireSupportedHabit(habit: UHabitsHabit | undefined): UHabitsHabit {
  if (!habit || (habit.type !== 0 && habit.type !== 1)) {
    throw new Error('Select a valid boolean or numerical habit.');
  }

  return habit;
}

function editDateRange(edit: HabitEdit): { start: number; end: number } {
  if (edit.kind === 'change-type') return { start: -Infinity, end: Infinity };
  if (edit.kind === 'copy' && (!edit.range.start || !edit.range.end)) {
    throw new Error('Copy requires both start and end dates.');
  }

  const start = edit.range.start ? parseHabitDate(edit.range.start) : -Infinity;
  const end = edit.range.end ? parseHabitDate(edit.range.end) : Infinity;
  if (start > end) throw new Error('Start date must be on or before end date.');

  return { start, end };
}

/** Validate the operation and return the destination metadata that will be exported. */
function resultHabitForEdit(
  source: UHabitsHabit,
  target: UHabitsHabit,
  edit: HabitEdit
): UHabitsHabit {
  if (edit.kind !== 'change-type' && source.id === target.id) {
    throw new Error('Source and destination must be different habits.');
  }
  if (edit.kind === 'fill' && source.type === target.type) {
    throw new Error('Fill requires one boolean and one numerical habit.');
  }
  if (edit.kind === 'copy') {
    if (source.type !== 0 || target.type !== 0)
      throw new Error('Copy requires two boolean habits.');
    return target;
  }

  const targetType = edit.kind === 'change-type' ? 1 - source.type : target.type;
  if (targetType === 0) {
    const validComparison = edit.comparison === 'at-least' || edit.comparison === 'at-most';
    if (!Number.isFinite(edit.threshold) || edit.threshold < 0 || !validComparison) {
      throw new Error('Enter a finite, non-negative threshold and a valid comparison.');
    }
  } else {
    storedNumericValue(edit.checkedValue);
    if (edit.kind === 'change-type') storedNumericValue(edit.targetValue);
  }

  if (edit.kind !== 'change-type') return target;

  return {
    ...target,
    type: targetType,
    unit: targetType === 1 ? edit.unit.trim() : '',
    target_value: targetType === 1 ? edit.targetValue : 0,
    target_type: targetType === 1 && edit.comparison === 'at-most' ? 1 : 0,
  };
}

/** Preserve unknown days; skipped and automatic boolean marks carry no numeric amount. */
function convertValue(value: number, sourceType: UHabitsHabit['type'], edit: HabitEdit): number {
  if (edit.kind === 'copy') return value;

  if (sourceType === 0) {
    if (value === 2) return storedNumericValue(edit.checkedValue);
    return value === 0 ? 0 : -1;
  }

  if (value < 0) return -1;

  const amount = value / NUMERIC_VALUE_SCALE;
  const checked =
    edit.comparison === 'at-least' ? amount >= edit.threshold : amount <= edit.threshold;
  return checked ? 2 : 0;
}

/** Compute the exact history and metadata used by the preview and export, without mutating the backup. */
export function planHabitEdit(
  backup: Pick<ParsedUHabitsBackup, 'allHabits' | 'repetitions'>,
  edit: HabitEdit
): HabitEditPlan {
  const sourceId = edit.kind === 'change-type' ? edit.habitId : edit.sourceId;
  const source = requireSupportedHabit(backup.allHabits.get(sourceId));
  const target =
    edit.kind === 'change-type'
      ? source
      : requireSupportedHabit(backup.allHabits.get(edit.targetId));
  const resultHabit = resultHabitForEdit(source, target, edit);
  const range = editDateRange(edit);

  const sourceHistory = backup.repetitions.filter((row) => row.habit_id === source.id);
  const sourceRows = sourceHistory.filter(
    (row) => row.timestamp >= range.start && row.timestamp <= range.end
  );
  const sourceDays = new Set(sourceRows.map((row) => row.timestamp));
  if (sourceDays.size !== sourceRows.length) {
    throw new Error(
      'Source habit has duplicate entries for a day; repair the backup before editing.'
    );
  }

  const before = backup.repetitions.filter((row) => row.habit_id === target.id);
  const existingDays = new Set(before.map((row) => row.timestamp));
  const writes: PlannedEntry[] = [];
  let preserved = 0;

  for (const row of sourceRows) {
    if (edit.kind !== 'change-type' && existingDays.has(row.timestamp) && !edit.overwrite) {
      preserved++;
      continue;
    }

    writes.push({
      sourceRepetitionId: row.id,
      timestamp: row.timestamp,
      value: convertValue(row.value, source.type, edit),
      notes: row.notes,
    });
  }

  const writtenDays = new Set(writes.map((row) => row.timestamp));
  const unchangedRows = before.filter((row) => !writtenDays.has(row.timestamp));
  const after = [...unchangedRows, ...writes].sort((a, b) => a.timestamp - b.timestamp);

  return { source, target, resultHabit, sourceHistory, writes, before, after, preserved };
}

/** Apply a plan in one transaction, keeping database column names in the shared Drizzle schema. */
function writeHabitEdit(db: Database, edit: HabitEdit, plan: HabitEditPlan): void {
  const orm = getUHabitsDb(db);

  db.run('BEGIN TRANSACTION');
  try {
    for (const entry of plan.writes) {
      if (edit.kind === 'change-type') {
        orm
          .update(repetitions)
          .set({ value: entry.value })
          .where(eq(repetitions.id, entry.sourceRepetitionId))
          .run();
      } else {
        orm
          .delete(repetitions)
          .where(
            and(eq(repetitions.habitId, plan.target.id), eq(repetitions.timestamp, entry.timestamp))
          )
          .run();
        orm
          .insert(repetitions)
          .values({
            habitId: plan.target.id,
            timestamp: entry.timestamp,
            value: entry.value,
            notes: entry.notes,
          })
          .run();
      }
    }

    if (edit.kind === 'change-type') {
      const habit = plan.resultHabit;
      orm
        .update(habits)
        .set({
          type: habit.type,
          unit: habit.unit,
          targetValue: habit.target_value,
          targetType: habit.target_type,
        })
        .where(eq(habits.id, habit.id))
        .run();
    }

    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

/** Export an independent, atomically edited copy; absent source days never erase destination data. */
export async function editUHabitsBackup(
  file: File,
  edit: HabitEdit,
  SQL: SqlJsStatic
): Promise<HabitEditResult> {
  const backup = await parseUHabitsBackup(file, SQL);

  try {
    const plan = planHabitEdit(backup, edit);
    writeHabitEdit(backup.db, edit, plan);

    const bytes = Uint8Array.from(backup.db.export());
    const blob = new Blob([bytes.buffer], { type: 'application/x-sqlite3' });
    return { blob, changed: plan.writes.length, preserved: plan.preserved };
  } finally {
    backup.db.close();
  }
}

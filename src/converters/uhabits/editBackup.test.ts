import { describe, expect, test } from 'vitest';
import {
  addHabit,
  addRepetition,
  createHabitTables,
  sqliteFile,
  useSqlite,
} from '@tests/helpers/sqlite';
import { fixtureFile } from '@tests/helpers/fixtures';
import {
  editUHabitsBackup,
  parseHabitDate,
  planHabitEdit,
  type HabitEdit,
  type HabitHistoryEntry,
} from './editBackup';
import { selectHabits, selectRepetitions } from '../../db/uhabitsRepo';

const sqlite = useSqlite();
const day = (date: number) => Date.UTC(2025, 0, date);
const rule = { threshold: 2.5, comparison: 'at-least' as const, checkedValue: 1.25 };

function seed() {
  const db = sqlite.open();
  createHabitTables(db);
  addHabit(db, 1, 'Apple', 0);
  addHabit(db, 2, 'Pear', 1, 'cups');
  addHabit(db, 3, 'Plum', 0);
  for (const [index, value] of [2, 0, 3, -1, 1].entries()) {
    addRepetition(db, { habitId: 1, timestamp: day(index + 1), value, notes: `Apple ${index}` });
  }
  for (const [index, value] of [2500, 0, 2499, -1, 3000].entries()) {
    addRepetition(db, { habitId: 2, timestamp: day(index + 1), value, notes: `Pear ${index}` });
  }
  addRepetition(db, { habitId: 3, timestamp: day(2), value: 2, notes: 'Keep plum' });
  addRepetition(db, { habitId: 3, timestamp: day(6), value: 0, notes: 'Outside range' });
  db.run('CREATE TABLE Extra (value TEXT)');
  db.run("INSERT INTO Extra VALUES ('preserve metadata')");
  db.run('PRAGMA user_version = 42');
  return { db, file: sqliteFile(db.export()) };
}

async function apply(file: File, edit: HabitEdit) {
  const result = await editUHabitsBackup(file, edit, sqlite.SQL);
  return { ...result, db: sqlite.open(new Uint8Array(await result.blob.arrayBuffer())) };
}

const history = (db: ReturnType<typeof sqlite.open>, id: number) =>
  selectRepetitions(db)
    .filter((row) => row.habit_id === id)
    .sort((a, b) => a.timestamp - b.timestamp);

describe('direct uHabits editing', () => {
  test('converts numerical values at the threshold and preserves unknown, notes, other habits and backup metadata', async () => {
    const { db, file } = seed();
    const original = selectRepetitions(db);
    const output = await apply(file, {
      ...rule,
      kind: 'change-type',
      habitId: 2,
      unit: '',
      targetValue: 1,
    });
    expect(history(output.db, 2).map((row) => row.value)).toEqual([2, 0, 0, -1, 2]);
    expect(history(output.db, 2).map((row) => row.notes)).toEqual(
      history(db, 2).map((row) => row.notes)
    );
    expect(history(output.db, 1)).toEqual(history(db, 1));
    const habit = selectHabits(output.db).find((h) => h.id === 2)!;
    expect(habit).toMatchObject({ type: 0, unit: '', target_value: 0, target_type: 0 });
    expect(selectRepetitions(db)).toEqual(original);
    expect(output.db.exec('PRAGMA user_version')[0].values).toEqual([[42]]);
    expect(output.db.exec('SELECT * FROM Extra')[0].values).toEqual([['preserve metadata']]);
    expect(output.changed).toBe(5);
  });

  test('supports at-most comparisons including a recorded zero', async () => {
    const { file } = seed();
    const output = await apply(file, {
      ...rule,
      comparison: 'at-most',
      kind: 'change-type',
      habitId: 2,
      unit: '',
      targetValue: 1,
    });
    expect(history(output.db, 2).map((row) => row.value)).toEqual([2, 2, 2, -1, 0]);
  });

  test('converts boolean history using thousandths and sets numeric habit metadata', async () => {
    const { file } = seed();
    const output = await apply(file, {
      ...rule,
      kind: 'change-type',
      habitId: 1,
      unit: ' cups ',
      targetValue: 2.5,
    });
    expect(history(output.db, 1).map((row) => row.value)).toEqual([1250, 0, -1, -1, -1]);
    expect(selectHabits(output.db).find((h) => h.id === 1)).toMatchObject({
      type: 1,
      unit: 'cups',
      target_value: 2.5,
      target_type: 0,
    });
  });

  test('fills numerical from boolean, preserving overlaps by default and replacing explicitly', async () => {
    const { db, file } = seed();
    const edit: HabitEdit = {
      ...rule,
      kind: 'fill',
      sourceId: 1,
      targetId: 2,
      range: {},
      overwrite: false,
    };
    const preserved = await apply(file, edit);
    expect(history(preserved.db, 2)).toEqual(history(db, 2));
    expect(preserved).toMatchObject({ changed: 0, preserved: 5 });
    const replaced = await apply(file, { ...edit, overwrite: true });
    expect(history(replaced.db, 2).map((row) => row.value)).toEqual([1250, 0, -1, -1, -1]);
    expect(history(replaced.db, 2).map((row) => row.notes)).toEqual(
      history(db, 1).map((row) => row.notes)
    );
    expect(selectHabits(replaced.db)).toEqual(selectHabits(db));
    expect(history(replaced.db, 1)).toEqual(history(db, 1));
  });

  test('fills boolean from numerical only inside inclusive bounds', async () => {
    const { file } = seed();
    const output = await apply(file, {
      ...rule,
      kind: 'fill',
      sourceId: 2,
      targetId: 3,
      range: { start: '2025-01-02', end: '2025-01-04' },
      overwrite: true,
    });
    expect(history(output.db, 3).map((row) => [row.timestamp, row.value, row.notes])).toEqual([
      [day(2), 0, 'Pear 1'],
      [day(3), 0, 'Pear 2'],
      [day(4), -1, 'Pear 3'],
      [day(6), 0, 'Outside range'],
    ]);
  });

  test('copies all boolean states and notes, preserves destination-only days, and is idempotent', async () => {
    const { db, file } = seed();
    const edit: HabitEdit = {
      kind: 'copy',
      sourceId: 1,
      targetId: 3,
      range: { start: '2025-01-01', end: '2025-01-06' },
      overwrite: false,
    };
    const output = await apply(file, edit);
    expect(output).toMatchObject({ changed: 4, preserved: 1 });
    expect(history(output.db, 3).map((row) => row.value)).toEqual([2, 2, 3, -1, 1, 0]);
    expect(history(output.db, 3).find((row) => row.timestamp === day(2))?.notes).toBe('Keep plum');
    expect(history(output.db, 1)).toEqual(history(db, 1));
    const repeated = await apply(sqliteFile(new Uint8Array(await output.blob.arrayBuffer())), edit);
    expect(repeated.changed).toBe(0);
    expect(history(repeated.db, 3)).toEqual(history(output.db, 3));
    const replaced = await apply(file, { ...edit, overwrite: true });
    expect(
      history(replaced.db, 3)
        .slice(0, 5)
        .map((row) => row.value)
    ).toEqual([2, 0, 3, -1, 1]);
  });

  test('rejects unsupported operations, missing habits, invalid rules and dates', async () => {
    const { file } = seed();
    const base: HabitEdit = {
      kind: 'copy',
      sourceId: 1,
      targetId: 3,
      range: { start: '2025-01-01', end: '2025-01-03' },
      overwrite: false,
    };
    for (const edit of [
      { ...base, targetId: 1 },
      { ...base, sourceId: 999 },
      { ...base, targetId: 2 },
      { ...base, range: { start: '', end: '' } },
      { ...base, range: { start: '2025-01-04', end: '2025-01-03' } },
      { ...base, range: { start: '2025-02-30', end: '2025-03-03' } },
      { ...base, ...rule, kind: 'fill' as const },
      {
        ...rule,
        kind: 'change-type' as const,
        habitId: 2,
        threshold: NaN,
        unit: '',
        targetValue: 1,
      },
      {
        ...rule,
        kind: 'change-type' as const,
        habitId: 1,
        checkedValue: Infinity,
        unit: '',
        targetValue: 1,
      },
      {
        ...rule,
        kind: 'change-type' as const,
        habitId: 1,
        checkedValue: 2147484,
        unit: '',
        targetValue: 1,
      },
      {
        ...rule,
        kind: 'change-type' as const,
        habitId: 1,
        checkedValue: 0,
        unit: '',
        targetValue: 1,
      },
    ])
      await expect(editUHabitsBackup(file, edit, sqlite.SQL)).rejects.toThrow();
  });

  test('rejects ambiguous duplicate source days', async () => {
    const { db } = seed();
    addRepetition(db, { habitId: 1, timestamp: day(1), value: 0 });
    await expect(
      editUHabitsBackup(
        sqliteFile(db.export()),
        { ...rule, kind: 'change-type', habitId: 1, unit: '', targetValue: 1 },
        sqlite.SQL
      )
    ).rejects.toThrow('duplicate');
  });

  test('edits and reopens the anonymized real backup without changing unrelated history', async () => {
    const file = await fixtureFile('habit-backfill/fixture-uhabits-anonymized.db');
    const original = sqlite.open(new Uint8Array(await file.arrayBuffer()));
    const habit = selectHabits(original).find((h) => h.type === 1)!;
    const output = await apply(file, {
      ...rule,
      kind: 'change-type',
      habitId: habit.id,
      unit: '',
      targetValue: 1,
    });
    expect(selectHabits(output.db).find((h) => h.id === habit.id)?.type).toBe(0);
    expect(selectRepetitions(output.db).filter((row) => row.habit_id !== habit.id)).toEqual(
      selectRepetitions(original).filter((row) => row.habit_id !== habit.id)
    );
    expect(output.db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']]);
  });

  test('date parsing rejects malformed dates and keeps UTC days stable', () => {
    expect(parseHabitDate('2025-01-01')).toBe(day(1));
    for (const date of ['2025-02-29', '2025-13-01', 'garbage', '2025-1-1'])
      expect(() => parseHabitDate(date)).toThrow();
  });
});

test('preview plans preserve input and match exported history for every edit operation', async () => {
  const { db, file } = seed();
  const backup = {
    allHabits: new Map(selectHabits(db).map((habit) => [habit.id, habit])),
    repetitions: selectRepetitions(db),
  };
  const snapshot = JSON.stringify([...backup.allHabits.values(), ...backup.repetitions]);
  const edits: HabitEdit[] = [
    { ...rule, kind: 'change-type', habitId: 1, unit: 'cups', targetValue: 3 },
    { ...rule, kind: 'change-type', habitId: 2, unit: '', targetValue: 1 },
    { ...rule, kind: 'fill', sourceId: 1, targetId: 2, range: {}, overwrite: true },
    {
      ...rule,
      kind: 'fill',
      sourceId: 2,
      targetId: 3,
      range: { start: '2025-01-02' },
      overwrite: false,
    },
    {
      kind: 'copy',
      sourceId: 1,
      targetId: 3,
      range: { start: '2025-01-01', end: '2025-01-04' },
      overwrite: false,
    },
  ];
  const contents = (rows: HabitHistoryEntry[]) =>
    rows.map(({ timestamp, value, notes }) => ({ timestamp, value, notes }));

  for (const edit of edits) {
    const plan = planHabitEdit(backup, edit);
    const output = await apply(file, edit);

    expect(contents(plan.before)).toEqual(contents(history(db, plan.target.id)));
    expect(contents(plan.after)).toEqual(contents(history(output.db, plan.target.id)));
    expect(plan.resultHabit).toEqual(
      selectHabits(output.db).find((habit) => habit.id === plan.target.id)
    );
    expect(output.changed).toBe(plan.writes.length);
    expect(output.preserved).toBe(plan.preserved);
    expect(JSON.stringify([...backup.allHabits.values(), ...backup.repetitions])).toBe(snapshot);
  }
});

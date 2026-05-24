import type { Database, SqlValue } from 'sql.js';
import { parseWithSchema } from '../schemas/sql';
import type * as v from 'valibot';

type RowObject = Record<string, SqlValue>;

function rowsFromExec(db: Database, sql: string, params: SqlValue[] = []): RowObject[] {
	const result = db.exec(sql, params);
	if (result.length === 0) return [];

	const rows: RowObject[] = [];
	for (const table of result) {
		for (const values of table.values) {
			const row: RowObject = {};
			table.columns.forEach((column, index) => {
				row[column] = values[index];
			});
			rows.push(row);
		}
	}
	return rows;
}

export function selectRows<T>(
	db: Database,
	sql: string,
	schema: v.GenericSchema<unknown, T>,
	params: SqlValue[] = []
): T[] {
	return rowsFromExec(db, sql, params).map((row) => parseWithSchema(schema, row, `SQL row for ${sql.trim()}`));
}

export function selectOne<T>(
	db: Database,
	sql: string,
	schema: v.GenericSchema<unknown, T>,
	params: SqlValue[] = []
): T | undefined {
	return selectRows(db, sql, schema, params)[0];
}

export function validatePayload<T>(
	schema: v.GenericSchema<unknown, T>,
	input: unknown,
	context: string
): T {
	return parseWithSchema(schema, input, context);
}

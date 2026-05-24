import * as v from 'valibot';

export const IntegerSchema = v.pipe(v.number(), v.finite(), v.integer());
export const SafeIntegerSchema = v.pipe(v.number(), v.finite(), v.safeInteger());
export const NonNegativeIntegerSchema = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0));
export const SqlNullableStringSchema = v.nullable(v.string());
export const OptionalStringSchema = v.optional(v.string());
export const OptionalNumberSchema = v.optional(v.number());
export const OptionalIntegerSchema = v.optional(IntegerSchema);
export const OptionalUnknownArraySchema = v.optional(v.array(v.unknown()));

export function parseWithSchema<T>(
	schema: v.GenericSchema<unknown, T>,
	input: unknown,
	context: string
): T {
	const result = v.safeParse(schema, input);
	if (result.success) return result.output;

	const summary = v.summarize(result.issues);
	throw new Error(`${context} failed validation: ${summary}`);
}

export function parseJsonWithSchema<T>(
	schema: v.GenericSchema<unknown, T>,
	text: string,
	context: string
): T {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error: any) {
		throw new Error(`${context} is not valid JSON: ${error.message || error.toString()}`);
	}
	return parseWithSchema(schema, raw, context);
}

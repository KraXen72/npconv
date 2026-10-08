import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { inject } from 'vitest';

declare module 'vitest' {
	interface ProvidedContext {
		fixturesRoot: string;
	}
}

/** Read a committed fixture by its path within fixtures/, regardless of the test's location. */
export function readFixture(path: string): Promise<Buffer> {
	return readFile(resolve(inject('fixturesRoot'), path));
}

/** Load a committed fixture as a real File for the application's import APIs. */
export async function fixtureFile(path: string, type = ''): Promise<File> {
	const bytes = await readFixture(path);
	return new File([Uint8Array.from(bytes).buffer], basename(path), { type });
}

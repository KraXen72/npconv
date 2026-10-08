import { afterEach, beforeEach, vi } from 'vitest';
import { logStore } from '../src/logger';

beforeEach(() => {
	logStore.clear();
	// Conversion fallbacks and log timestamps must not depend on the wall clock.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2025-06-07T12:00:00Z'));
});

afterEach(() => {
	logStore.clear();
	vi.useRealTimers();
});

import { describe, expect, test } from 'vitest';
import { log, logStore } from './logger';

/** Returns only the HTML appended by `fn`, since the log store is a shared singleton. */
function captureLog(fn: () => void): string {
	const before = logStore.logs();
	fn();
	return logStore.logs().slice(before.length);
}

describe('logger', () => {
	test('log_wrapsTimestampInDedicatedSpanBeforeMessage', () => {
		const html = captureLog(() => log('hello'));

		expect(html).toMatch(/^<div class="log-info"><span class="log-time">\[[^\]<]+\]<\/span> hello<\/div>$/);
	});

	test.each([
		['info', 'log-info'],
		['warn', 'log-warn'],
		['err', 'log-err'],
		['schema', 'log-schema'],
		['something-unknown', 'log-info']
	])('log_type%s_usesClass%s', (type, className) => {
		const html = captureLog(() => log('msg', type));

		expect(html.startsWith(`<div class="${className}">`)).toBe(true);
	});

	test('log_escapesHtmlInMessagesBeforeInnerHtmlRendering', () => {
		const html = captureLog(() => log('<img src=x onerror=alert(1)> & "quoted"', 'err'));

		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;');
	});

	test('log_appendsEntriesInOrder', () => {
		const html = captureLog(() => {
			log('first');
			log('second');
		});

		expect(html.indexOf('first')).toBeGreaterThan(-1);
		expect(html.indexOf('second')).toBeGreaterThan(html.indexOf('first'));
	});
});

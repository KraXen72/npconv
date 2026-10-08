import { describe, expect, test } from 'vitest';
import { log, logStore } from './logger';

describe('logger', () => {
	test('renders the timestamp before the message when an entry is logged', () => {
		const message = 'hello';

		log(message);
		const html = logStore.logs();

		expect(html).toMatch(/^<div class="log-info"><span class="log-time">\[[^\]<]+\]<\/span> hello<\/div>$/);
	});

	test.each([
		['info', 'log-info'],
		['warn', 'log-warn'],
		['err', 'log-err'],
		['schema', 'log-schema'],
		['something-unknown', 'log-info']
	])('uses class %s → %s when a log type is supplied', (type, className) => {
		const message = 'msg';

		log(message, type);
		const html = logStore.logs();

		expect(html.startsWith(`<div class="${className}">`)).toBe(true);
	});

	test('escapes HTML when a message contains markup', () => {
		const message = '<img src=x onerror=alert(1)> & "quoted"';

		log(message, 'err');
		const html = logStore.logs();

		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;');
	});

	test('preserves entry order when multiple messages are logged', () => {
		const messages = ['first', 'second'];

		messages.forEach(message => log(message));
		const html = logStore.logs();

		expect(html.indexOf('first')).toBeGreaterThan(-1);
		expect(html.indexOf('second')).toBeGreaterThan(html.indexOf('first'));
	});
});

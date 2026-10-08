import { describe, expect, test } from 'vitest';
import { clampToSafeInt, extractVideoIdFromUrl, formatUploadDate, parseAccessDateToMs } from './utils';

describe('video URL extraction', () => {
	test.each([
		['https://www.youtube.com/watch?v=abc&list=playlist', 'abc'],
		['https://youtu.be/abc?t=30', 'abc'],
		['https://www.youtube.com/shorts/abc?feature=share', 'abc'],
		['https://www.youtube.com/embed/abc', 'abc'],
		['https://www.youtube.com/channel/example', ''],
		['', ''],
		[null, '']
	])('returns the video ID when the input is %s', (input, expectedId) => {
		const url = input;

		const videoId = extractVideoIdFromUrl(url);

		expect(videoId).toBe(expectedId);
	});
});

describe('safe integer conversion', () => {
	test.each([
		[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
		[Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER],
		[-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER],
		[-Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER],
		[12.9, 12],
		[-12.9, -12],
		['42', 42],
		[Infinity, 0],
		[NaN, 0],
		['invalid', 0],
		[undefined, 0]
	])('returns a bounded integer when the input is %s', (input, expectedValue) => {
		const value = input;

		const converted = clampToSafeInt(value);

		expect(converted).toBe(expectedValue);
	});
});

describe('backup date normalization', () => {
	test.each([
		[1700000000, '2023-11-14'],
		[1700000000000, '2023-11-14'],
		[20230424, '2023-04-24'],
		['2025-06-07T10:00:00+02:00', '2025-06-07'],
		['2 days ago', '1970-01-01'],
		[undefined, '1970-01-01'],
		[0, '1970-01-01'],
		[-1, '1969-12-31']
	])('exports a calendar date when the upload date is %s', (input, expectedDate) => {
		const uploadDate = input;

		const formatted = formatUploadDate(uploadDate);

		expect(formatted).toBe(expectedDate);
	});

	test.each([
		[1700000000, 1700000000000],
		[1700000000000, 1700000000000],
		['1700000000', 1700000000000],
		['1700000000000', 1700000000000],
		['2025-06-07T10:00:00+02:00', Date.UTC(2025, 5, 7, 8)],
		['invalid', 0],
		['  ', 0],
		[null, 0],
		[undefined, 0]
	])('returns milliseconds when the access date is %s', (input, expectedTimestamp) => {
		const accessDate = input;

		const timestamp = parseAccessDateToMs(accessDate);

		expect(timestamp).toBe(expectedTimestamp);
	});
});

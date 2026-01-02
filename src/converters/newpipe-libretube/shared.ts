import type { Database } from 'sql.js';

/**
 * Check if a URL is a YouTube URL
 */
export function isYouTubeUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	return url.includes("youtube.com") || url.includes("youtu.be");
}

/**
 * Deduplicate items by a key function
 */
export function deduplicateByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
	const seen = new Set<string>();
	const result: T[] = [];
	for (const item of items) {
		const key = keyFn(item);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(item);
		}
	}
	return result;
}

/**
 * Execute a callback within a SQL transaction
 */
export function sqlTransaction(db: Database, callback: () => void): void {
	db.run("BEGIN TRANSACTION");
	try {
		callback();
		db.run("COMMIT");
	} catch (e) {
		db.run("ROLLBACK");
		throw e;
	}
}

/**
 * Playlist merge behaviors
 */
export type PlaylistBehavior = 
	| 'merge_np_precedence' 
	| 'merge_lt_precedence' 
	| 'only_newpipe' 
	| 'only_libretube';

/**
 * Determine if target playlists should be cleared based on behavior and direction
 * @param behavior Playlist behavior setting
 * @param npToLt true if converting NewPipe→LibreTube, false if LibreTube→NewPipe
 */
export function shouldClearTarget(behavior: PlaylistBehavior | null, npToLt: boolean): boolean {
	if (!behavior) return false;
	if (npToLt) {
		// NewPipe → LibreTube: clear target if 'only_newpipe'
		return behavior === 'only_newpipe';
	} else {
		// LibreTube → NewPipe: clear target if 'only_libretube'
		return behavior === 'only_libretube';
	}
}

/**
 * Determine if source playlists should be skipped based on behavior and direction
 * @param behavior Playlist behavior setting
 * @param npToLt true if converting NewPipe→LibreTube, false if LibreTube→NewPipe
 */
export function shouldSkipImport(behavior: PlaylistBehavior | null, npToLt: boolean): boolean {
	if (!behavior) return false;
	if (npToLt) {
		// NewPipe → LibreTube: skip import if 'only_libretube'
		return behavior === 'only_libretube';
	} else {
		// LibreTube → NewPipe: skip import if 'only_newpipe'
		return behavior === 'only_newpipe';
	}
}

/**
 * Determine conflict resolution for individual playlist based on behavior
 * @param behavior Playlist behavior setting
 * @param npToLt true if converting NewPipe→LibreTube, false if LibreTube→NewPipe
 * @returns 'source' to use source playlist, 'target' to keep target playlist
 */
export function resolvePlaylistConflict(
	behavior: PlaylistBehavior | null, 
	npToLt: boolean
): 'source' | 'target' {
	if (!behavior) return 'source'; // default: source precedence
	
	if (behavior === 'merge_np_precedence') {
		// NewPipe has precedence
		return npToLt ? 'source' : 'target';
	} else if (behavior === 'merge_lt_precedence') {
		// LibreTube has precedence
		return npToLt ? 'target' : 'source';
	}
	
	return 'source'; // default
}

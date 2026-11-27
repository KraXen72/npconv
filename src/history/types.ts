export type HistorySource = 'NewPipe' | 'LibreTube';
export type SearchField = 'all' | 'title' | 'description' | 'videoId' | 'channel';

/** One video across all uploaded history entries and its recorded watch metadata. */
export interface HistoryVideo {
  id: string;
  videoId: string;
  title: string;
  description: string;
  channel: string;
  channelUrl: string;
  firstWatchedAt: number | null;
  lastWatchedAt: number | null;
  uploadDate: string | null;
  sources: { name: HistorySource; watchCount: number | null }[];
}

export interface HistoryImport {
  videos: HistoryVideo[];
  skipped: number;
}

export const HISTORY_PAGE_SIZE = 40;

export interface HistoryPage {
  videos: HistoryVideo[];
  total: number;
  page: number;
}

export type HistoryRequest =
  | { type: 'load'; newpipe: File | null; libretube: File | null }
  | { type: 'search'; requestId: number; query: string; field: SearchField; page: number };

export type HistoryResponse =
  | { type: 'ready'; total: number; descriptions: number; skipped: number; errors: string[] }
  | { type: 'results'; requestId: number; result: HistoryPage }
  | { type: 'error'; message: string };

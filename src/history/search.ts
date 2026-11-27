import MiniSearch from 'minisearch';
import { extractVideoIdFromUrl } from '../utils';
import { HISTORY_PAGE_SIZE, type HistoryPage, type HistoryVideo, type SearchField } from './types';

const tokenize: (text: string) => string[] = MiniSearch.getDefault('tokenize');

function normalizeTerm(term: string): string {
  return term.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Merge repeated watches, keeping the newest metadata and filling its missing fields. */
export function mergeHistory(videos: HistoryVideo[]): HistoryVideo[] {
  const merged = new Map<string, HistoryVideo>();
  for (const video of videos) {
    const existing = merged.get(video.id);
    if (!existing) {
      merged.set(video.id, { ...video, sources: [...video.sources] });
      continue;
    }

    const newer = (video.lastWatchedAt ?? 0) > (existing.lastWatchedAt ?? 0) ? video : existing;
    const older = newer === video ? existing : video;
    const sources = new Map(existing.sources.map((source) => [source.name, source]));
    for (const source of video.sources) {
      const previous = sources.get(source.name);
      sources.set(source.name, {
        name: source.name,
        watchCount: Math.max(previous?.watchCount ?? 0, source.watchCount ?? 0) || null,
      });
    }
    const firstDates = [existing.firstWatchedAt, existing.lastWatchedAt, video.firstWatchedAt, video.lastWatchedAt]
      .filter((date): date is number => date !== null);
    merged.set(video.id, {
      ...newer,
      title: newer.title || older.title,
      description: newer.description || older.description,
      channel: newer.channel || older.channel,
      channelUrl: newer.channelUrl || older.channelUrl,
      firstWatchedAt: firstDates.length ? Math.min(...firstDates) : null,
      uploadDate: newer.uploadDate || older.uploadDate,
      sources: [...sources.values()],
    });
  }
  return [...merged.values()].sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0));
}

/** Build one inverted index per upload; cache each query's ranking across result pages. */
export class HistorySearch {
  readonly videos: HistoryVideo[];
  readonly descriptions: number;
  private readonly byId: Map<string, HistoryVideo>;
  private readonly index: MiniSearch<HistoryVideo>;
  private cachedQuery = '';
  private cachedField: SearchField = 'all';
  private matches: string[] | null = null;

  constructor(videos: HistoryVideo[]) {
    this.videos = mergeHistory(videos);
    this.byId = new Map(this.videos.map((video) => [video.id, video]));
    this.descriptions = this.videos.reduce((count, video) => count + Number(!!video.description), 0);
    this.index = new MiniSearch<HistoryVideo>({
      fields: ['title', 'description', 'videoId', 'channel'],
      extractField: (video, field) => field === 'channel'
        ? `${video.channel} ${video.channelUrl}`
        : video[field as keyof HistoryVideo],
      tokenize: (text, field) => field === 'videoId' ? [text, ...tokenize(text)] : tokenize(text),
      processTerm: normalizeTerm,
    });
    this.index.addAll(this.videos);
  }

  /** All words must match; a blank query returns the latest watched videos. */
  search(query: string, field: SearchField = 'all', page = 0): HistoryPage {
    const trimmed = query.trim();
    const videoId = (field === 'all' || field === 'videoId') && extractVideoIdFromUrl(trimmed);
    const normalizedQuery = normalizeTerm(videoId || trimmed);
    if (normalizedQuery !== this.cachedQuery || field !== this.cachedField) {
      this.cachedQuery = normalizedQuery;
      this.cachedField = field;
      this.matches = normalizedQuery ? this.index.search(normalizedQuery, {
        fields: field === 'all' ? undefined : [field],
        boost: { videoId: 5, title: 3, channel: 2, description: 1 },
        combineWith: 'AND',
        prefix: (term) => term.length >= 2,
        fuzzy: (term) => field !== 'videoId' && term.length >= 4 ? 1 : false,
        tokenize: videoId || field === 'videoId' ? (text) => [text] : tokenize,
      }).sort((a, b) => b.score - a.score ||
        (this.byId.get(b.id)?.lastWatchedAt ?? 0) - (this.byId.get(a.id)?.lastWatchedAt ?? 0)
      ).map((result) => String(result.id)) : null;
    }

    const total = this.matches?.length ?? this.videos.length;
    const currentPage = Math.max(0, Math.min(Math.floor(page), Math.max(0, Math.ceil(total / HISTORY_PAGE_SIZE) - 1)));
    const start = currentPage * HISTORY_PAGE_SIZE;
    const videos = this.matches
      ? this.matches.slice(start, start + HISTORY_PAGE_SIZE).map((id) => this.byId.get(id)!)
      : this.videos.slice(start, start + HISTORY_PAGE_SIZE);
    return { videos, total, page: currentPage };
  }
}

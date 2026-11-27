import { initSQL } from '../sqlHelper';
import { readLibreTubeHistory, readNewPipeHistory } from './import';
import { HistorySearch } from './search';
import type { HistoryRequest, HistoryResponse, HistoryVideo } from './types';

let search: HistorySearch | undefined;
const respond = (message: HistoryResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<HistoryRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      search = undefined;
      const videos: HistoryVideo[] = [];
      const errors: string[] = [];
      let skipped = 0;
      for (const [source, file] of [['NewPipe', request.newpipe], ['LibreTube', request.libretube]] as const) {
        if (!file) continue;
        try {
          const imported = source === 'NewPipe'
            ? await readNewPipeHistory(file, await initSQL())
            : await readLibreTubeHistory(file);
          for (const video of imported.videos) videos.push(video);
          skipped += imported.skipped;
        } catch (error: unknown) {
          errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      search = new HistorySearch(videos);
      respond({ type: 'ready', total: search.videos.length, descriptions: search.descriptions, skipped, errors });
    } else if (search) {
      respond({ type: 'results', requestId: request.requestId, result: search.search(request.query, request.field, request.page) });
    }
  } catch (error: unknown) {
    respond({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

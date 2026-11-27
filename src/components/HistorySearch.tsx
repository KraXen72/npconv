import { createEffect, createSignal, For, onCleanup, Show, type Component } from 'solid-js';
import HistoryWorker from '../history/history.worker?worker';
import { HISTORY_PAGE_SIZE, type HistoryPage, type HistoryRequest, type HistoryResponse, type SearchField } from '../history/types';

interface Props {
  newpipe: File | null;
  libretube: File | null;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Search uploaded history off the UI thread and render one bounded result page. */
export const HistorySearch: Component<Props> = (props) => {
  const [query, setQuery] = createSignal('');
  const [field, setField] = createSignal<SearchField>('all');
  const [page, setPage] = createSignal(0);
  const [ready, setReady] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [total, setTotal] = createSignal(0);
  const [descriptions, setDescriptions] = createSignal(0);
  const [skipped, setSkipped] = createSignal(0);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [results, setResults] = createSignal<HistoryPage>({ videos: [], total: 0, page: 0 });
  let worker: Worker | undefined;
  let requestId = 0;

  createEffect(() => {
    const newpipe = props.newpipe;
    const libretube = props.libretube;
    setReady(false);
    setBusy(!!(newpipe || libretube));
    setTotal(0);
    setDescriptions(0);
    setSkipped(0);
    setErrors([]);
    setPage(0);
    setResults({ videos: [], total: 0, page: 0 });
    requestId++;
    if (!newpipe && !libretube) return;

    const currentWorker = new HistoryWorker();
    worker = currentWorker;
    const fail = (message: string) => {
      setBusy(false);
      setErrors([message]);
    };
    currentWorker.onmessage = (event: MessageEvent<HistoryResponse>) => {
      const response = event.data;
      if (response.type === 'ready') {
        setTotal(response.total);
        setDescriptions(response.descriptions);
        setSkipped(response.skipped);
        setErrors(response.errors);
        setReady(true);
      } else if (response.type === 'results' && response.requestId === requestId) {
        setResults(response.result);
        setBusy(false);
      } else if (response.type === 'error') {
        fail(response.message);
      }
    };
    currentWorker.onerror = () => fail('History search could not start. Reload the page and upload the backup again.');
    currentWorker.postMessage({ type: 'load', newpipe, libretube } satisfies HistoryRequest);
    onCleanup(() => {
      currentWorker.terminate();
      if (worker === currentWorker) worker = undefined;
    });
  });

  createEffect(() => {
    const text = query();
    const selectedField = field();
    const selectedPage = page();
    if (!ready() || !worker) return;
    const id = ++requestId;
    setBusy(true);
    setResults({ videos: [], total: 0, page: selectedPage });
    const timer = setTimeout(() => worker?.postMessage({
      type: 'search', requestId: id, query: text, field: selectedField, page: selectedPage,
    } satisfies HistoryRequest), 100);
    onCleanup(() => clearTimeout(timer));
  });

  const changePage = (next: number) => {
    setPage(next);
    document.getElementById('history-heading')?.scrollIntoView({ block: 'start' });
  };

  return (
    <section class="controls-block history-search" aria-labelledby="history-heading" aria-busy={busy()}>
      <h3 id="history-heading">Search watch history</h3>
      <p class="history-help" id="history-help">Upload either backup above, or both. Search words across fields; partial words and small typos work. Videos open in a new tab.</p>
      <div class="history-fields">
        <label class="history-query" for="history-query">
          Search history
          <input
            id="history-query"
            type="search"
            placeholder="Title, description, video ID or channel"
            value={query()}
            aria-describedby="history-help history-descriptions"
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => { setPage(0); setQuery(event.currentTarget.value); }}
          />
        </label>
        <label for="history-field">
          Search in
          <select id="history-field" value={field()} onChange={(event) => {
            setPage(0);
            setField(event.currentTarget.value as SearchField);
          }}>
            <option value="all">All fields</option>
            <option value="title">Title</option>
            <option value="description">Description</option>
            <option value="videoId">Video ID / URL</option>
            <option value="channel">Channel name / URL</option>
          </select>
        </label>
      </div>
      <p class="history-help" id="history-descriptions">
        <Show when={ready() && total() > 0} fallback="Descriptions are searchable when included in the export. NewPipe backups usually omit video descriptions.">
          Descriptions available for {descriptions().toLocaleString()} of {total().toLocaleString()} videos. Search uses exported metadata only.
        </Show>
      </p>
      <For each={errors()}>{(error) => <p class="history-error" role="alert">{error}</p>}</For>
      <Show when={skipped() > 0}>
        <p class="history-help">Skipped {skipped().toLocaleString()} history entries with missing or invalid video links.</p>
      </Show>
      <p class="history-status" role="status" aria-live="polite">
        {busy() ? (ready() ? 'Searching…' : 'Reading backups and building search index…')
          : !ready() ? 'Choose a NewPipe ZIP or LibreTube JSON backup to start.'
          : total() === 0 ? 'No watch history found in the uploaded backups.'
          : results().total === 0 ? 'No matching videos. Try another search or field.'
          : `${results().total.toLocaleString()} ${query().trim() ? 'matching' : 'watched'} ${results().total === 1 ? 'video' : 'videos'} · ${query().trim() ? 'Best matches first' : 'Most recently watched first'}`}
      </p>
      <ul class="history-results" aria-label="Watch history results">
        <For each={results().videos}>{(video) => (
          <li>
            <a class="history-video" href={video.id} target="_blank" rel="noopener noreferrer">
              <span class="history-video-title">{video.title || video.videoId}<svg class="history-open" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M7 7h10v10" /></svg></span>
              <span class="history-channel">{video.channel || 'Unknown channel'}</span>
              <Show when={video.description}><span class="history-description">{video.description}</span></Show>
              <span class="history-meta">
                <span class="history-id">{video.videoId}</span>
                <For each={video.sources}>{(source) => (
                  <span>{source.name}{source.watchCount !== null ? ` · ${source.watchCount.toLocaleString()} ${source.watchCount === 1 ? 'watch' : 'watches'}` : ''}</span>
                )}</For>
              </span>
              <dl class="history-dates">
                <Show when={video.firstWatchedAt}>{(date) => (
                  <div><dt>First recorded watch</dt><dd><time datetime={new Date(date()).toISOString()}>{dateFormat.format(date())}</time></dd></div>
                )}</Show>
                <Show when={video.lastWatchedAt}>{(date) => (
                  <div><dt>Last recorded watch</dt><dd><time datetime={new Date(date()).toISOString()}>{dateFormat.format(date())}</time></dd></div>
                )}</Show>
                <Show when={video.uploadDate}>{(date) => <div><dt>Uploaded</dt><dd>{date()}</dd></div>}</Show>
              </dl>
            </a>
          </li>
        )}</For>
      </ul>
      <Show when={results().total > HISTORY_PAGE_SIZE}>
        <nav class="history-pagination" aria-label="History result pages">
          <button type="button" disabled={busy() || results().page === 0} onClick={() => changePage(page() - 1)}>Previous</button>
          <span>Page {results().page + 1} of {Math.ceil(results().total / HISTORY_PAGE_SIZE).toLocaleString()}</span>
          <button type="button" disabled={busy() || (results().page + 1) * HISTORY_PAGE_SIZE >= results().total} onClick={() => changePage(page() + 1)}>Next</button>
        </nav>
      </Show>
    </section>
  );
};

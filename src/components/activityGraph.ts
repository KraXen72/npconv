import type { ActivityGrid } from 'activity-grid';

/** Reveal the latest populated day in a year without scrolling the graph's controls or legend. */
export function scrollToLatestActivity(
  grid: ActivityGrid,
  dates: Iterable<string>,
  year: number
): void {
  const prefix = `${year}-`;
  let latestDate = '';

  for (const date of dates) {
    if (date.startsWith(prefix) && date > latestDate) latestDate = date;
  }

  const cell = grid.shadowRoot?.querySelector<HTMLElement>(`.cell[data-date="${latestDate}"]`);
  const scroller = grid.parentElement;
  if (!cell || !scroller) return;

  const trailingSpace = 24;
  scroller.scrollLeft = Math.max(0, cell.offsetLeft - scroller.clientWidth + trailingSpace);
}

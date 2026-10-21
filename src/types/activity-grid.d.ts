import type { ActivityGrid } from 'activity-grid';
import type { JSX } from 'solid-js';

// activity-grid registers its element at runtime but does not declare Solid JSX attributes.
declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'activity-grid': JSX.HTMLAttributes<ActivityGrid> & {
        'start-week-on-monday'?: boolean;
        'dark-mode'?: boolean;
      };
    }
  }
}

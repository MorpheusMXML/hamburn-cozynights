// src/routes/map/+page.ts
import type { PageLoad } from './$types';

/**
 * When the browser got the map's numbers, by its own clock (this load runs
 * again in the browser, also for a preload). The page compares it with the
 * same clock to tell data that is already old; a server clock that runs ahead
 * or behind would make every visit look old (loaded twice) or none.
 */
export const load: PageLoad = ({ data }) => ({ ...data, receivedAt: Date.now() });

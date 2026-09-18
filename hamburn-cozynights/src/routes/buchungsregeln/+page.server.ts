import type { PageServerLoad } from './$types';
import { getLegalInfo } from '$lib/server/legal';

export const load: PageServerLoad = () => ({ legal: getLegalInfo() });

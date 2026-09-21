import type { RequestHandler } from './$types';
import { serveDocs } from '$lib/server/static-docs';

// The docs site links to folders as "/docs/guide/"; SvelteKit would redirect the slash away.
export const trailingSlash = 'ignore';

/** The public documentation (guest guide), built from ../docs into the Docker image. */
export const GET: RequestHandler = ({ url, request }) => serveDocs('public', url, request.method);

import type { RequestHandler } from './$types';
import { refuseAdminDocs, serveDocs } from '$lib/server/static-docs';

// The docs site links to folders as "/admin/docs/guide/"; SvelteKit would redirect the slash away.
export const trailingSlash = 'ignore';

/** The full documentation including the admin guide, for approved admins only. */
export const GET: RequestHandler = ({ locals, url, request }) => {
	// hooks.server.ts lets GET requests below /admin pass (pages redirect in their
	// layout), and an endpoint has no layout: the session check has to happen here.
	// A pending access request is not an admin session.
	if (!locals.admin) return refuseAdminDocs(url);
	return serveDocs('admin', url, request.method);
};

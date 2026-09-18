import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';

/**
 * Serves the documentation site from inside the app.
 *
 * The docs (../docs, VitePress) are built twice into the Docker image: the
 * "public" build has the guest guide only, the "admin" build has everything.
 * Both are plain folders of static files, but the admin one must only reach
 * signed-in admins, so neither lives in static/ (which is served without any
 * code running). The routes /docs and /admin/docs hand their requests to
 * {@link serveDocs}; the admin route checks the session first.
 */
export type DocsAudience = 'public' | 'admin';

/** Where each build is served; must match the DOCS_BASE it was built with (Dockerfile). */
export const DOCS_MOUNT: Record<DocsAudience, string> = {
	public: '/docs',
	admin: '/admin/docs'
};

const NO_STORE = 'private, no-store';

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.xml': 'application/xml; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2'
};

export type DocsLookup =
	| { type: 'file'; file: string }
	/** A folder requested without its trailing slash; `to` is the request path with it. */
	| { type: 'redirect'; to: string }
	| { type: 'not-found' };

/** Folder of one build: `$DOCS_DIR/<audience>`, by default `./docs-dist/<audience>`. */
export function docsRoot(audience: DocsAudience): string {
	return path.resolve(env.DOCS_DIR || 'docs-dist', audience);
}

/**
 * Turns the part of the URL path below the mount point ("/guide/faq") into a
 * relative file path ("guide/faq"), or null if it could leave the docs folder
 * or name a hidden file. A trailing slash survives: it means "this folder".
 */
export function normalizeDocsPath(requestPath: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(requestPath);
	} catch {
		return null;
	}
	if (decoded.includes('\0') || decoded.includes('\\')) return null;

	const relative = decoded.replace(/^\/+/, '');
	if (relative === '') return '';

	const segments = relative.split('/');
	const isFolder = segments.at(-1) === '';
	if (isFolder) segments.pop();
	// Covers ".", ".." and dotfiles; an empty segment is a doubled slash.
	if (segments.some((segment) => segment === '' || segment.startsWith('.'))) return null;

	return segments.join('/') + (isFolder ? '/' : '');
}

async function isFile(file: string): Promise<boolean> {
	try {
		return (await stat(file)).isFile();
	} catch {
		return false;
	}
}

/**
 * Maps a request path to a file of the build in `root`, the way static hosts
 * serve VitePress' clean URLs: "/guide/" is guide/index.html, "/guide/faq" is
 * guide/faq.html, anything with a file of its own name is that file.
 */
export async function findDocsFile(root: string, requestPath: string): Promise<DocsLookup> {
	const relative = normalizeDocsPath(requestPath);
	if (relative === null) return { type: 'not-found' };

	const inRoot = (candidate: string): string | null => {
		const file = path.resolve(root, candidate);
		// Second line of defense behind normalizeDocsPath.
		return file.startsWith(path.resolve(root) + path.sep) ? file : null;
	};
	const existing = async (candidate: string): Promise<string | null> => {
		const file = inRoot(candidate);
		return file && (await isFile(file)) ? file : null;
	};

	if (relative === '' || relative.endsWith('/')) {
		const index = await existing(`${relative}index.html`);
		return index ? { type: 'file', file: index } : { type: 'not-found' };
	}

	const file = (await existing(relative)) ?? (await existing(`${relative}.html`));
	if (file) return { type: 'file', file };

	if (await existing(`${relative}/index.html`)) return { type: 'redirect', to: `/${relative}/` };
	return { type: 'not-found' };
}

/** Pages (clean URLs, folders, .html) as opposed to scripts, styles, images and data. */
export function isDocsPage(pathname: string): boolean {
	const extension = path.posix.extname(pathname);
	return extension === '' || extension === '.html';
}

/** The answer for visitors without an admin session, before any file is looked at. */
export function refuseAdminDocs(url: URL): Response {
	// A page navigation goes to the login; scripts, styles and the search index just say no.
	return isDocsPage(url.pathname)
		? new Response(null, {
				status: 303,
				headers: { location: '/admin/login', 'cache-control': NO_STORE }
			})
		: new Response('Forbidden', { status: 403, headers: { 'cache-control': NO_STORE } });
}

function cacheControl(audience: DocsAudience, requestPath: string): string {
	if (audience === 'admin') return NO_STORE;
	// VitePress puts a content hash into every file name below assets/.
	return requestPath.startsWith('/assets/')
		? 'public, max-age=31536000, immutable'
		: 'public, max-age=300';
}

const MISSING_DOCS_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Documentation not available</title></head>
<body>
<h1>Documentation not available</h1>
<p>The documentation is not part of this build. It is built into the Docker image;
for a local preview run <code>npm run dev</code> in the <code>docs</code> folder.</p>
</body>
</html>
`;

async function sendFile(
	file: string,
	method: string,
	status: number,
	cache: string
): Promise<Response> {
	const body = await readFile(file);
	return new Response(method === 'HEAD' ? null : body, {
		status,
		headers: {
			'content-type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
			'content-length': String(body.byteLength),
			'cache-control': cache,
			'x-content-type-options': 'nosniff'
		}
	});
}

/** Answers a GET/HEAD request below {@link DOCS_MOUNT} from the build for `audience`. */
export async function serveDocs(
	audience: DocsAudience,
	url: URL,
	method: string
): Promise<Response> {
	const mount = DOCS_MOUNT[audience];
	const root = docsRoot(audience);
	const requestPath = url.pathname.slice(mount.length);

	// VitePress resolves everything against "<mount>/", so the bare mount needs its slash too.
	const found: DocsLookup =
		requestPath === '' ? { type: 'redirect', to: '/' } : await findDocsFile(root, requestPath);

	if (found.type === 'file') {
		return sendFile(found.file, method, 200, cacheControl(audience, requestPath));
	}
	if (found.type === 'redirect') {
		return new Response(null, {
			status: 308,
			headers: { location: mount + encodeURI(found.to) + url.search, 'cache-control': NO_STORE }
		});
	}

	const notFoundPage = path.join(root, '404.html');
	if (await isFile(notFoundPage)) return sendFile(notFoundPage, method, 404, NO_STORE);

	return new Response(method === 'HEAD' ? null : MISSING_DOCS_PAGE, {
		status: 404,
		headers: { 'content-type': MIME_TYPES['.html'], 'cache-control': NO_STORE }
	});
}

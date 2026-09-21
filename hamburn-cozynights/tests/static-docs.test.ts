// tests/static-docs.test.ts — the docs site served by the app: path safety, clean URLs, admin gate
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { findDocsFile, isDocsPage, normalizeDocsPath } from '../src/lib/server/static-docs';
import { GET as publicDocs } from '../src/routes/docs/[...path]/+server';
import { GET as adminDocs } from '../src/routes/admin/docs/[...path]/+server';

const ADMIN = {
	id: 'a1',
	email: 'max@mauersegler.art',
	name: 'Max',
	role: 'admin',
	isSuperuser: false
};

let dir: string;
let publicRoot: string;

beforeAll(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), 'cozy-docs-'));
	publicRoot = path.join(dir, 'public');
	const files: Record<string, string> = {
		'public/index.html': 'public home',
		'public/404.html': 'public 404',
		'public/guide/index.html': 'guide home',
		'public/guide/faq.html': 'guide faq',
		'public/assets/app.abc123.js': 'console.log(1)',
		'public/assets/chunks/@localSearchIndexroot.abc123.js': 'export default "{}"',
		'public/.hidden.html': 'hidden',
		'admin/index.html': 'admin home',
		'admin/404.html': 'admin 404',
		'admin/admin/index.html': 'control center guide',
		'admin/assets/app.def456.js': 'console.log(2)',
		'secret.txt': 'outside of both builds'
	};
	for (const [name, content] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
		await writeFile(path.join(dir, name), content);
	}
	(env as Record<string, string>).DOCS_DIR = dir;
});

afterAll(async () => {
	delete (env as Record<string, string | undefined>).DOCS_DIR;
	await rm(dir, { recursive: true, force: true });
});

type Handler = (event: never) => Response | Promise<Response>;

function request(handler: Handler, pathname: string, locals: object = {}) {
	const url = new URL(`http://localhost${pathname}`);
	const event = { url, request: new Request(url), locals: { admin: null, ...locals } };
	return Promise.resolve(handler(event as never));
}

describe('normalizeDocsPath', () => {
	it('keeps ordinary paths and the folder slash', () => {
		expect(normalizeDocsPath('/')).toBe('');
		expect(normalizeDocsPath('/guide/')).toBe('guide/');
		expect(normalizeDocsPath('/guide/faq')).toBe('guide/faq');
		expect(normalizeDocsPath('/assets/chunks/%40localSearchIndexroot.abc123.js')).toBe(
			'assets/chunks/@localSearchIndexroot.abc123.js'
		);
	});

	it.each([
		'/../secret.txt',
		'/guide/../../secret.txt',
		'/..%2Fsecret.txt',
		'/%2e%2e/secret.txt',
		'/guide/..',
		'/./index.html',
		'/.hidden.html',
		'/guide/.git/config',
		'/guide//faq',
		'/guide\\..\\..\\secret.txt',
		'/guide%5C..%5Csecret.txt',
		'/index.html%00.png',
		'/%E0%A4%A'
	])('rejects %s', (requestPath) => {
		expect(normalizeDocsPath(requestPath)).toBeNull();
	});
});

describe('findDocsFile', () => {
	it('maps clean URLs the way VitePress links to them', async () => {
		const file = (name: string) => ({ type: 'file', file: path.join(publicRoot, name) });
		expect(await findDocsFile(publicRoot, '/')).toEqual(file('index.html'));
		expect(await findDocsFile(publicRoot, '/guide/')).toEqual(file('guide/index.html'));
		expect(await findDocsFile(publicRoot, '/guide/faq')).toEqual(file('guide/faq.html'));
		expect(await findDocsFile(publicRoot, '/guide/faq.html')).toEqual(file('guide/faq.html'));
		expect(await findDocsFile(publicRoot, '/assets/app.abc123.js')).toEqual(
			file('assets/app.abc123.js')
		);
	});

	it('adds the missing slash to folders and reports everything else as not found', async () => {
		expect(await findDocsFile(publicRoot, '/guide')).toEqual({ type: 'redirect', to: '/guide/' });
		expect(await findDocsFile(publicRoot, '/admin/')).toEqual({ type: 'not-found' });
		expect(await findDocsFile(publicRoot, '/guide/nope')).toEqual({ type: 'not-found' });
		expect(await findDocsFile(publicRoot, '/assets/')).toEqual({ type: 'not-found' });
	});

	it('never leaves its build folder', async () => {
		for (const attempt of [
			'/../secret.txt',
			'/..%2Fsecret.txt',
			'/%252e%252e/secret.txt',
			'/../admin/index.html',
			'/guide/../../admin/admin/',
			'/.hidden.html'
		]) {
			expect(await findDocsFile(publicRoot, attempt)).toEqual({ type: 'not-found' });
		}
	});
});

describe('isDocsPage', () => {
	it('tells pages from assets', () => {
		expect(isDocsPage('/admin/docs/')).toBe(true);
		expect(isDocsPage('/admin/docs/admin/access')).toBe(true);
		expect(isDocsPage('/admin/docs/index.html')).toBe(true);
		expect(isDocsPage('/admin/docs/assets/app.def456.js')).toBe(false);
		expect(isDocsPage('/admin/docs/hashmap.json')).toBe(false);
	});
});

describe('GET /docs', () => {
	it('serves pages with a short cache and hashed assets as immutable', async () => {
		const page = await request(publicDocs, '/docs/guide/faq');
		expect(page.status).toBe(200);
		expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(page.headers.get('cache-control')).toBe('public, max-age=300');
		expect(await page.text()).toBe('guide faq');

		const asset = await request(publicDocs, '/docs/assets/app.abc123.js');
		expect(asset.status).toBe(200);
		expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
		expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	});

	it('redirects the bare mount point and folders to their slash', async () => {
		const mount = await request(publicDocs, '/docs');
		expect(mount.status).toBe(308);
		expect(mount.headers.get('location')).toBe('/docs/');

		const folder = await request(publicDocs, '/docs/guide?x=1');
		expect(folder.status).toBe(308);
		expect(folder.headers.get('location')).toBe('/docs/guide/?x=1');
	});

	it("answers unknown and admin-only paths with the build's 404 page", async () => {
		for (const pathname of ['/docs/admin/', '/docs/admin/access', '/docs/..%2Fadmin/index.html']) {
			const response = await request(publicDocs, pathname);
			expect(response.status).toBe(404);
			expect(await response.text()).toBe('public 404');
		}
	});

	it('explains itself when the image was built without docs', async () => {
		(env as Record<string, string>).DOCS_DIR = path.join(dir, 'does-not-exist');
		try {
			const response = await request(publicDocs, '/docs/');
			expect(response.status).toBe(404);
			expect(await response.text()).toContain('not part of this build');
		} finally {
			(env as Record<string, string>).DOCS_DIR = dir;
		}
	});
});

describe('GET /admin/docs', () => {
	it('sends visitors without an admin session to the login, assets get a 403', async () => {
		const pending = { pendingAdmin: { email: 'new@mauersegler.art', name: 'New' } };
		for (const locals of [{}, pending]) {
			for (const pathname of [
				'/admin/docs',
				'/admin/docs/',
				'/admin/docs/admin/',
				'/admin/docs/x'
			]) {
				const page = await request(adminDocs, pathname, locals);
				expect(page.status).toBe(303);
				expect(page.headers.get('location')).toBe('/admin/login');
				expect(page.headers.get('cache-control')).toBe('private, no-store');
			}

			const asset = await request(adminDocs, '/admin/docs/assets/app.def456.js', locals);
			expect(asset.status).toBe(403);
			expect(await asset.text()).not.toContain('console.log');
		}
	});

	it('serves everything to an admin, never cacheable', async () => {
		for (const [pathname, body] of [
			['/admin/docs/', 'admin home'],
			['/admin/docs/admin/', 'control center guide'],
			['/admin/docs/assets/app.def456.js', 'console.log(2)']
		]) {
			const response = await request(adminDocs, pathname, { admin: ADMIN });
			expect(response.status).toBe(200);
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(await response.text()).toBe(body);
		}

		const missing = await request(adminDocs, '/admin/docs/nope', { admin: ADMIN });
		expect(missing.status).toBe(404);
		expect(missing.headers.get('cache-control')).toBe('private, no-store');
		expect(await missing.text()).toBe('admin 404');
	});
});

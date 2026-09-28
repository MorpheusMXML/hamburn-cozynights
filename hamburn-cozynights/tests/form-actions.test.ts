// tests/form-actions.test.ts — every form action the app posts to exists on the
// page the post lands on. `?/name` lands on the page that shows the form or
// script, `/admin?/name` on /admin. SvelteKit answers a page without actions
// with 405 Method Not Allowed and a missing action with 404: after the Control
// Center split, /admin/camp posted `?/updateHouseCoords` to itself and no house
// could be moved, renamed or deleted any more.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ROUTES = path.join(SRC, 'routes');

/** `?/name` or `/path?/name` as a whole string literal: action=, formaction=, fetch, submitAction. */
const ACTION_URL = /(["'`])((?:\/[\w-]+)*\/?)\?\/(\w+)\1/g;
const SVELTE_IMPORT = /from\s+['"]([^'"]+\.svelte)['"]/g;

const svelteFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
	.filter((file) => file.endsWith('.svelte'))
	.map((file) => path.join(SRC, file));

/** Which files import each component. */
const importers = new Map<string, Set<string>>();
for (const file of svelteFiles) {
	for (const [, spec] of readFileSync(file, 'utf8').matchAll(SVELTE_IMPORT)) {
		const imported = spec.startsWith('$lib/')
			? path.join(SRC, 'lib', spec.slice('$lib/'.length))
			: spec.startsWith('.')
				? path.resolve(path.dirname(file), spec)
				: null;
		if (!imported) continue;
		if (!importers.has(imported)) importers.set(imported, new Set());
		importers.get(imported)!.add(file);
	}
}

/** The pages and layouts a component ends up on. */
function shownOn(file: string, seen = new Set<string>()): string[] {
	if (/\+(page|layout)\.svelte$/.test(file)) return [file];
	if (seen.has(file)) return [];
	seen.add(file);
	return [...(importers.get(file) ?? [])].flatMap((parent) => shownOn(parent, seen));
}

/** The names in a page's `export const actions = { … }`, or null when it has none. */
function actionsOf(pageDir: string): string[] | null {
	const file = path.join(pageDir, '+page.server.ts');
	if (!existsSync(file)) return null;
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (declaration.name.getText(source) !== 'actions') continue;
			let value = declaration.initializer;
			while (value && (ts.isSatisfiesExpression(value) || ts.isAsExpression(value))) {
				value = value.expression;
			}
			if (value && ts.isObjectLiteralExpression(value)) {
				return value.properties.map((property) => property.name?.getText(source) ?? '');
			}
		}
	}
	return null;
}

const route = (dir: string) => '/' + path.relative(ROUTES, dir).split(path.sep).join('/');

/** One post: where it is written, its URL, and the page directory it lands on. */
type Post = { at: string; url: string; name: string; lands: string | 'a layout' };

const posts: Post[] = svelteFiles.flatMap((file) => {
	const text = readFileSync(file, 'utf8');
	return [...text.matchAll(ACTION_URL)].flatMap((match) => {
		const [, , target, name] = match;
		const at = `src/${path.relative(SRC, file)}:${text.slice(0, match.index).split('\n').length}`;
		const url = `${target}?/${name}`;
		if (target) return [{ at, url, name, lands: path.join(ROUTES, target) }];
		// A layout shows its form on every page below it: a bare `?/…` there
		// lands wherever the admin or guest happens to be.
		return shownOn(file).map((shown) => ({
			at,
			url,
			name,
			lands: shown.endsWith('+layout.svelte') ? 'a layout' : path.dirname(shown)
		}));
	});
});

describe('form actions', () => {
	it('finds the posts of pages and of the components they show', () => {
		expect(posts.length).toBeGreaterThan(40);
		// With a path in front, and a bare one from a component, checked on its page.
		expect(posts.some((post) => post.url.startsWith('/admin'))).toBe(true);
		expect(posts.some((post) => post.at.startsWith('src/lib/') && post.url.startsWith('?/'))).toBe(
			true
		);
	});

	it('every post lands on a page that has that action', () => {
		const broken = posts.flatMap((post) => {
			if (post.lands === 'a layout') {
				return [`${post.at} posts to ${post.url} from a layout: write the page's path in front`];
			}
			const actions = actionsOf(post.lands);
			if (actions === null) {
				return [`${post.at} posts to ${post.url}, but ${route(post.lands)} has no actions (405)`];
			}
			if (!actions.includes(post.name)) {
				return [
					`${post.at} posts to ${post.url}, but ${route(post.lands)} has no such action (404)`
				];
			}
			return [];
		});
		expect(broken).toEqual([]);
	});
});

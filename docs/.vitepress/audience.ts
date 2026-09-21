import type { DefaultTheme, MarkdownRenderer } from 'vitepress';

/**
 * The docs are built twice from one source tree (see develop/docs.md):
 * "public" is what guests get, "admin" is everything. This file is the only
 * place that says who sees what; config.mts derives nav, sidebar, excluded
 * sources, search and the home page from it.
 */
export type Audience = 'public' | 'admin';
const AUDIENCES: readonly Audience[] = ['public', 'admin'];

interface Section {
	/** Top-level folder in docs/. */
	dir: string;
	audiences: readonly Audience[];
	nav: DefaultTheme.NavItemWithLink;
	sidebar: DefaultTheme.SidebarItem[];
}

const sections: Section[] = [
	{
		dir: 'guide',
		audiences: ['public', 'admin'],
		nav: { text: 'Guide', link: '/guide/', activeMatch: '^/guide/' },
		sidebar: [
			{
				text: 'Guide',
				items: [
					{ text: 'What is CozyNights?', link: '/guide/' },
					{ text: 'Booking a bed', link: '/guide/booking' },
					{ text: 'Special-needs spot', link: '/guide/special-needs' },
					{ text: 'Staging, Live & Closed', link: '/guide/phases' },
					{ text: 'FAQ & troubleshooting', link: '/guide/faq' }
				]
			},
			{
				text: 'Next',
				items: [
					{ text: 'Admin guide', link: '/admin/' },
					{ text: 'Under the hood', link: '/reference/architecture' }
				]
			}
		]
	},
	{
		dir: 'admin',
		audiences: ['admin'],
		nav: { text: 'Admin', link: '/admin/', activeMatch: '^/admin/' },
		sidebar: [
			{
				text: 'Admin guide',
				items: [
					{ text: 'The Control Center', link: '/admin/' },
					{ text: 'Admin access & roles', link: '/admin/access' },
					{ text: 'Tickets & e-mail addresses', link: '/admin/tickets' },
					{ text: 'Notifications', link: '/admin/notifications' },
					{ text: 'Booking passes & check-in', link: '/admin/passes' },
					{ text: 'Special-needs requests', link: '/admin/special-needs' },
					{ text: 'Houses, rooms & spots', link: '/admin/camp-layout' },
					{ text: 'Layout templates', link: '/admin/templates' },
					{ text: 'Event checklist', link: '/admin/event-checklist' },
					{ text: 'Legal pages', link: '/admin/legal' }
				]
			},
			{
				text: 'Related',
				items: [
					{ text: 'Staging, Live & Closed', link: '/guide/phases' },
					{ text: 'How guests book', link: '/guide/booking' }
				]
			}
		]
	},
	{
		dir: 'reference',
		audiences: ['admin'],
		nav: {
			text: 'Under the hood',
			link: '/reference/architecture',
			activeMatch: '^/reference/'
		},
		sidebar: [
			{
				text: 'Under the hood',
				items: [
					{ text: 'Architecture', link: '/reference/architecture' },
					{ text: 'Data model & templates', link: '/reference/data-model' },
					{ text: 'Security & privacy', link: '/reference/security' }
				]
			}
		]
	},
	{
		dir: 'develop',
		audiences: ['admin'],
		nav: { text: 'Develop', link: '/develop/', activeMatch: '^/develop/' },
		sidebar: [
			{
				text: 'Develop',
				items: [
					{ text: 'Local development', link: '/develop/' },
					{ text: 'Testing & release checks', link: '/develop/testing' },
					{ text: 'Layout: no squeezed text', link: '/develop/layout' },
					{ text: 'Environments & deployment', link: '/develop/deployment' },
					{ text: 'Branches, integration & releases', link: '/develop/integration' },
					{ text: 'Landing page title', link: '/develop/effigy-title' },
					{ text: 'Working on these docs', link: '/develop/docs' }
				]
			}
		]
	}
];

/** A typo must fail the build: falling back to "admin" could publish the admin pages. */
export function readAudience(value: string | undefined, what = 'DOCS_AUDIENCE'): Audience {
	if (!value) return 'admin';
	if ((AUDIENCES as readonly string[]).includes(value)) return value as Audience;
	throw new Error(`${what} must be "public" or "admin", got "${value}"`);
}

export function audienceSite(audience: Audience) {
	const visible = sections.filter((section) => section.audiences.includes(audience));
	const hiddenDirs = sections.filter((section) => !visible.includes(section)).map((s) => s.dir);

	/** Site-absolute link ("/admin/access") into a section this audience doesn't get. */
	const isHiddenLink = (link: string | undefined): boolean =>
		!!link && hiddenDirs.some((dir) => link === `/${dir}` || link.startsWith(`/${dir}/`));

	const prune = (items: DefaultTheme.SidebarItem[]): DefaultTheme.SidebarItem[] =>
		items
			.filter((item) => !isHiddenLink(item.link))
			.map((item) => (item.items ? { ...item, items: prune(item.items) } : item))
			.filter((item) => item.link || item.items?.length);

	return {
		srcExclude: hiddenDirs.map((dir) => `${dir}/**`),
		nav: visible.map((section) => section.nav),
		sidebar: Object.fromEntries(
			visible.map((section) => [`/${section.dir}/`, prune(section.sidebar)])
		) as DefaultTheme.SidebarMulti,
		isHiddenLink
	};
}

const OPEN = /^<!--\s*audience:\s*(\S+?)\s*-->$/;
const CLOSE = /^<!--\s*\/audience\s*-->$/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * Keeps or drops the lines between `<!-- audience:admin -->` (or `:public`)
 * and `<!-- /audience -->`. The markers sit on their own lines, are invisible
 * on GitHub, and are ignored inside code fences. Anything unexpected throws,
 * because a marker that is silently not recognised would leak its block into
 * the other build.
 */
export function filterAudienceBlocks(src: string, audience: Audience, file = 'markdown'): string {
	const out: string[] = [];
	let fence: string | null = null;
	let block: { audience: Audience; line: number } | null = null;

	for (const [index, line] of src.split('\n').entries()) {
		const text = line.trim();
		const where = `${file}:${index + 1}`;
		const [, fenceMark, fenceInfo] = FENCE.exec(line) ?? [];
		if (fence) {
			const closes = fenceMark?.[0] === fence[0] && fenceMark.length >= fence.length;
			if (closes && !fenceInfo.trim()) fence = null;
		} else if (fenceMark) {
			fence = fenceMark;
		} else if (OPEN.test(text)) {
			if (block) throw new Error(`${where}: audience blocks can't be nested`);
			block = {
				audience: readAudience(OPEN.exec(text)![1], `${where}: audience`),
				line: index + 1
			};
			continue;
		} else if (CLOSE.test(text)) {
			if (!block) throw new Error(`${where}: "/audience" without an open block`);
			block = null;
			continue;
		}
		if (!block || block.audience === audience) out.push(line);
	}

	if (block) throw new Error(`${file}:${block.line}: audience block is never closed`);
	return out.join('\n');
}

export function audienceBlocksPlugin(md: MarkdownRenderer, audience: Audience) {
	// Before anything is parsed, so dropped text reaches neither the page,
	// the dead-link check nor the search index (they share this renderer).
	md.core.ruler.before('normalize', 'audience-blocks', (state) => {
		state.src = filterAudienceBlocks(state.src, audience, state.env?.relativePath);
	});
}

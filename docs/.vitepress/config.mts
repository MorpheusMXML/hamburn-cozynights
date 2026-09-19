import { spawnSync } from 'node:child_process';
import { defineConfigWithTheme, type DefaultTheme, type HeadConfig } from 'vitepress';
import { audienceBlocksPlugin, audienceSite, readAudience } from './audience';

const repo = 'https://github.com/MorpheusMXML/hamburn-cozynights';
const pagesBase = '/hamburn-cozynights/';
const pagesUrl = 'https://morpheusmxml.github.io/hamburn-cozynights/';
// Until production has a domain, the public docs point to staging for the legal pages.
const stagingAppUrl = 'https://test-cozynights.hamburn.de';

// One source tree, two sites (see develop/docs.md): DOCS_AUDIENCE picks who the
// build is for, DOCS_BASE where it is served from. The defaults are what you
// want while writing: every page, under the GitHub Pages path.
const audience = readAudience(process.env.DOCS_AUDIENCE);
const site = audienceSite(audience);
const base = process.env.DOCS_BASE || pagesBase;
if (!base.startsWith('/') || !base.endsWith('/')) {
	throw new Error(`DOCS_BASE must start and end with "/", got "${base}"`);
}
// Absolute URL of the published site, for the sitemap and link previews. Only
// known for GitHub Pages; the app serves the docs under whatever domain it runs on.
const siteUrl = process.env.DOCS_SITE_URL || (base === pagesBase ? pagesUrl : '');
// The legal notice, privacy policy and booking rules are pages of the app, not of the docs
// (the operator's details live in the app server's .env). Served by the app,
// the docs link them on the same domain; on GitHub Pages they need the app's
// address: DOCS_APP_URL, set as a repository variable for the Pages build.
const appUrl = (process.env.DOCS_APP_URL || (base === pagesBase ? stagingAppUrl : '')).replace(
	/\/$/,
	''
);
const legal = {
	notice: `${appUrl}/legal-notice`,
	privacy: `${appUrl}/privacy`,
	rules: `${appUrl}/booking-rules`
};

/** Theme settings of this site on top of VitePress' default theme (see theme/LegalLinks.vue). */
export interface CozyThemeConfig extends DefaultTheme.Config {
	legal: { notice: string; privacy: string; rules: string };
}

// "Last updated" comes from git, which the Docker build has neither as a
// command nor as history; VitePress would crash there.
const hasGitHistory = spawnSync('git', ['rev-parse', '--is-inside-work-tree']).status === 0;

const description =
	'Bed booking for Hamburn: ticket holders pick their own bed on the camp map, the crew runs the camp from one control center.';

const head: HeadConfig[] = [
	['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
	['link', { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }],
	['meta', { name: 'theme-color', content: '#f472b6' }],
	['meta', { property: 'og:type', content: 'website' }],
	['meta', { property: 'og:site_name', content: 'Hamburn CozyNights' }],
	['meta', { property: 'og:title', content: 'Hamburn CozyNights' }],
	['meta', { property: 'og:description', content: description }]
];
if (siteUrl) {
	head.push(
		['meta', { property: 'og:image', content: `${siteUrl}og-image.png` }],
		['meta', { name: 'twitter:card', content: 'summary_large_image' }]
	);
}
// The admin site sits behind the admin login; nothing of it belongs in a search engine.
if (audience === 'admin') head.push(['meta', { name: 'robots', content: 'noindex' }]);

export default defineConfigWithTheme<CozyThemeConfig>({
	lang: 'en-US',
	title: 'Hamburn CozyNights',
	titleTemplate: ':title · CozyNights',
	description,
	base,
	outDir: `.vitepress/dist/${audience}`,
	cleanUrls: true,
	lastUpdated: hasGitHistory,
	appearance: 'dark',
	// Old agent planning notes live next to the site sources; they are not docs.
	srcExclude: ['superpowers/**', ...site.srcExclude],
	...(audience === 'public' && siteUrl ? { sitemap: { hostname: siteUrl } } : {}),
	// Every other dead link fails the build; local dev URLs are fine.
	ignoreDeadLinks: 'localhostLinks',
	vite: {
		// Mermaid is only loaded on pages with diagrams, as its own (large) chunks.
		build: { chunkSizeWarningLimit: 2500 }
	},

	head,

	// The home page lists every entry point in its frontmatter; the ones this
	// audience has no pages for are dropped.
	transformPageData({ frontmatter }) {
		const visible = (item: { link?: string }) => !site.isHiddenLink(item.link);
		const { hero, features } = frontmatter;
		if (hero?.actions) hero.actions = hero.actions.filter(visible);
		if (features) frontmatter.features = features.filter(visible);
	},

	markdown: {
		image: { lazyLoading: true },
		// GitHub-style task lists ("- [ ] item") are built in since VitePress 2, but rendered
		// disabled by default. Enabled, the checkboxes are clickable; theme/index.ts remembers them.
		tasklist: { disabled: false },
		config(md) {
			audienceBlocksPlugin(md, audience);

			// ```mermaid fences become diagrams, rendered in the browser (see theme/Mermaid.vue).
			// GitHub renders the same fences natively, so the Markdown stays readable there.
			const fence = md.renderer.rules.fence!;
			md.renderer.rules.fence = (tokens, idx, options, env, self) => {
				const token = tokens[idx];
				if (token.info.trim() === 'mermaid') {
					return `<Mermaid code="${encodeURIComponent(token.content)}" />`;
				}
				return fence(tokens, idx, options, env, self);
			};
		}
	},

	themeConfig: {
		logo: { src: '/swift.png', alt: '' },
		siteTitle: 'CozyNights',

		nav: site.nav,
		sidebar: site.sidebar,

		socialLinks: [{ icon: 'github', link: repo, ariaLabel: 'GitHub repository' }],

		editLink: {
			pattern: `${repo}/edit/main/docs/:path`,
			text: 'Suggest a change to this page'
		},

		search: { provider: 'local' },

		outline: { level: [2, 3], label: 'On this page' },

		lastUpdated: {
			text: 'Last updated',
			formatOptions: { dateStyle: 'medium' }
		},

		notFound: {
			title: 'LOST IN THE DUST',
			quote: 'This page wandered off into the night. Let’s get you back to camp.',
			linkText: 'Back to camp'
		},

		legal,

		footer: {
			// Only shown on pages without a sidebar; doc pages get theme/LegalLinks.vue.
			message: `Made with 🔥 for Hamburn by the Mauersegler* crew. · <a href="${legal.notice}" target="_self">Legal notice</a> · <a href="${legal.privacy}" target="_self">Privacy</a> · <a href="${legal.rules}" target="_self">Booking rules</a>`,
			copyright: `<a href="${repo}">Source on GitHub</a>`
		}
	}
});

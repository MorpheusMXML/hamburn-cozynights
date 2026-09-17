import { defineConfig } from 'vitepress';

const repo = 'https://github.com/MorpheusMXML/hamburn-cozynights';
const siteUrl = 'https://morpheusmxml.github.io/hamburn-cozynights/';
const description =
	'Bed booking for Hamburn: ticket holders pick their own bed on the camp map, the crew runs the camp from one control center.';

export default defineConfig({
	lang: 'en-US',
	title: 'Hamburn CozyNights',
	titleTemplate: ':title · CozyNights',
	description,
	// Published as a GitHub project page: https://morpheusmxml.github.io/hamburn-cozynights/
	base: '/hamburn-cozynights/',
	cleanUrls: true,
	lastUpdated: true,
	appearance: 'dark',
	// Old agent planning notes live next to the site sources; they are not docs.
	srcExclude: ['superpowers/**'],
	sitemap: { hostname: siteUrl },
	// Every other dead link fails the build; local dev URLs are fine.
	ignoreDeadLinks: 'localhostLinks',
	vite: {
		// Mermaid is only loaded on pages with diagrams, as its own (large) chunks.
		build: { chunkSizeWarningLimit: 2500 }
	},

	head: [
		['link', { rel: 'icon', type: 'image/png', href: '/hamburn-cozynights/favicon.png' }],
		['link', { rel: 'apple-touch-icon', href: '/hamburn-cozynights/apple-touch-icon.png' }],
		['meta', { name: 'theme-color', content: '#f472b6' }],
		['meta', { property: 'og:type', content: 'website' }],
		['meta', { property: 'og:site_name', content: 'Hamburn CozyNights' }],
		['meta', { property: 'og:title', content: 'Hamburn CozyNights' }],
		['meta', { property: 'og:description', content: description }],
		['meta', { property: 'og:image', content: `${siteUrl}og-image.png` }],
		['meta', { name: 'twitter:card', content: 'summary_large_image' }]
	],

	markdown: {
		image: { lazyLoading: true },
		config(md) {
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

			// GitHub-style task lists ("- [ ] item"), as GitHub renders them too.
			// The checkboxes are clickable; theme/index.ts remembers their state.
			md.core.ruler.push('task-lists', (state) => {
				const tokens = state.tokens;
				for (let i = 2; i < tokens.length; i++) {
					const inline = tokens[i];
					if (
						inline.type !== 'inline' ||
						tokens[i - 1].type !== 'paragraph_open' ||
						tokens[i - 2].type !== 'list_item_open'
					) {
						continue;
					}
					const first = inline.children?.[0];
					const match = first?.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null;
					if (!first || !match) continue;

					first.content = first.content.slice(match[0].length);
					const checkbox = new state.Token('html_inline', '', 0);
					checkbox.content = `<input type="checkbox" class="task-list-item-checkbox"${
						match[1] === ' ' ? '' : ' checked'
					} aria-label="Done"> `;
					inline.children!.unshift(checkbox);
					tokens[i - 2].attrJoin('class', 'task-list-item');
				}
			});
		}
	},

	themeConfig: {
		logo: { src: '/swift.png', alt: '' },
		siteTitle: 'CozyNights',

		nav: [
			{ text: 'Guide', link: '/guide/', activeMatch: '^/guide/' },
			{ text: 'Admin', link: '/admin/', activeMatch: '^/admin/' },
			{ text: 'Under the hood', link: '/reference/architecture', activeMatch: '^/reference/' },
			{ text: 'Develop', link: '/develop/', activeMatch: '^/develop/' }
		],

		sidebar: {
			'/guide/': [
				{
					text: 'Guide',
					items: [
						{ text: 'What is CozyNights?', link: '/guide/' },
						{ text: 'Booking a bed', link: '/guide/booking' },
						{ text: 'Staging & Live Booking', link: '/guide/phases' },
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
			],
			'/admin/': [
				{
					text: 'Admin guide',
					items: [
						{ text: 'The Control Center', link: '/admin/' },
						{ text: 'Admin access & roles', link: '/admin/access' },
						{ text: 'Houses, rooms & spots', link: '/admin/camp-layout' },
						{ text: 'Layout templates', link: '/admin/templates' },
						{ text: 'Event checklist', link: '/admin/event-checklist' }
					]
				},
				{
					text: 'Related',
					items: [
						{ text: 'Staging & Live Booking', link: '/guide/phases' },
						{ text: 'How guests book', link: '/guide/booking' }
					]
				}
			],
			'/reference/': [
				{
					text: 'Under the hood',
					items: [
						{ text: 'Architecture', link: '/reference/architecture' },
						{ text: 'Security & privacy', link: '/reference/security' }
					]
				}
			],
			'/develop/': [
				{
					text: 'Develop',
					items: [
						{ text: 'Local development', link: '/develop/' },
						{ text: 'Environments & deployment', link: '/develop/deployment' },
						{ text: 'Working on these docs', link: '/develop/docs' }
					]
				}
			]
		},

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

		footer: {
			message: 'Made with 🔥 for Hamburn by the Mauersegler* crew.',
			copyright: `<a href="${repo}">Source on GitHub</a>`
		}
	}
});

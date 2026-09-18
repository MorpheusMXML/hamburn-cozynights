import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { useRoute } from 'vitepress';
import mediumZoom, { type Zoom } from 'medium-zoom';
import { h, nextTick, onMounted, watch } from 'vue';
import LegalLinks from './LegalLinks.vue';
import Mermaid from './Mermaid.vue';
import './style.css';

export default {
	extends: DefaultTheme,
	// Impressum and privacy policy under every doc page (the default footer
	// only appears on pages without a sidebar).
	Layout: () => h(DefaultTheme.Layout, null, { 'doc-after': () => h(LegalLinks) }),
	enhanceApp({ app }) {
		app.component('Mermaid', Mermaid);
	},
	setup() {
		const route = useRoute();

		// Click-to-zoom for screenshots. One zoom instance, re-attached after every
		// client-side navigation because the page content is replaced.
		let zoom: Zoom | undefined;
		const attachZoom = () => {
			zoom ??= mediumZoom({ background: 'var(--vp-c-bg)', margin: 24 });
			zoom.detach();
			zoom.attach('.vp-doc img:not(.no-zoom)');
		};

		// Checklists: remember ticked boxes per page in this browser only.
		const restoreChecklists = () => {
			const boxes = document.querySelectorAll<HTMLInputElement>(
				'.vp-doc input.task-list-item-checkbox'
			);
			boxes.forEach((box, index) => {
				const key = `cozynights-docs:checklist:${route.path}:${index}`;
				try {
					box.checked = localStorage.getItem(key) === '1';
				} catch {
					/* storage unavailable: boxes still work, just aren't remembered */
				}
				box.onchange = () => {
					try {
						if (box.checked) localStorage.setItem(key, '1');
						else localStorage.removeItem(key);
					} catch {
						/* ignore */
					}
				};
			});
		};

		const enhancePage = () => {
			attachZoom();
			restoreChecklists();
		};
		onMounted(enhancePage);
		watch(
			() => route.path,
			() => nextTick(enhancePage)
		);
	}
} satisfies Theme;

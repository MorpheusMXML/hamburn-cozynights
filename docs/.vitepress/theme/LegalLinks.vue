<!--
Links to the app's legal notice, privacy policy and booking rules under every
doc page, plus the "made in Hamburg" credit (the same line as the app's footer)
and the note that the guide is rebuilt with every release: the Pages site with
every version tag, the app's copy with every deploy (develop/docs.md).
VitePress only shows its footer on pages without a sidebar, so doc pages get
this instead (see index.ts). The addresses come from `themeConfig.legal` in
config.mts. target="_self" keeps the VitePress router from treating them as
doc pages: they belong to the app.
-->
<script setup lang="ts">
import { useData } from 'vitepress';
import type { CozyThemeConfig } from '../config.mts';

const { theme } = useData<CozyThemeConfig>();
</script>

<template>
	<footer class="doc-footer">
		<p class="version-note">
			This guide is rebuilt with every release, so it matches the latest deployed version of
			CozyNights.
		</p>
		<nav v-if="theme.legal" class="legal-links" aria-label="Legal">
			<a :href="theme.legal.notice" target="_self">Legal notice</a>
			<span aria-hidden="true">·</span>
			<a :href="theme.legal.privacy" target="_self">Privacy</a>
			<span aria-hidden="true">·</span>
			<a :href="theme.legal.rules" target="_self">Booking rules</a>
		</nav>
		<p class="made-in-hamburg">
			<span>Made with <span class="heart" role="img" aria-label="love">♥</span> in Hamburg by</span>
			<span class="makers">
				<svg
					class="kraken"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					role="img"
					aria-label="Claude"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<title>Claude</title>
					<path d="M12 2.4v1.4" />
					<circle cx="12" cy="1.7" r="0.9" fill="currentColor" stroke="none" />
					<rect x="4.5" y="3.8" width="15" height="10.4" rx="4.6" />
					<circle cx="9.4" cy="8.6" r="1.25" fill="currentColor" stroke="none" />
					<circle cx="14.6" cy="8.6" r="1.25" fill="currentColor" stroke="none" />
					<path d="M10.2 11.5q1.8 1.1 3.6 0" />
					<path d="M7.2 14.2C6.9 16.8 5.6 18.5 3.4 19c-.9.2-1.4-.5-1-1" />
					<path d="M10.3 14.2c-.1 3.2-.8 5.4-2.5 6.8-.7.6-1.5.2-1.3-.6" />
					<path d="M13.7 14.2c.1 3.2.8 5.4 2.5 6.8.7.6 1.5.2 1.3-.6" />
					<path d="M16.8 14.2c.3 2.6 1.6 4.3 3.8 4.8.9.2 1.4-.5 1-1" />
				</svg>
				<span aria-hidden="true">&amp;</span>
				<a href="https://github.com/MorpheusMXML" target="_blank" rel="noopener">Morpheus</a>
			</span>
		</p>
	</footer>
</template>

<style scoped>
.doc-footer {
	margin-top: 3rem;
	padding-top: 1rem;
	border-top: 1px solid var(--vp-c-divider);
	color: var(--vp-c-text-3);
	font-size: 0.8rem;
	text-align: center;
}

.version-note {
	margin: 0 0 0.5rem;
	font-size: 0.75rem;
}

.legal-links {
	display: flex;
	justify-content: center;
	gap: 0.5rem;
}

.made-in-hamburg {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	align-items: center;
	gap: 0.1rem 0.4rem;
	margin: 0.4rem 0 0;
	font-size: 0.75rem;
}

.makers {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	color: var(--vp-c-text-2);
}

.kraken {
	vertical-align: -0.2em;
}

.heart {
	color: #f472b6;
}

.made-in-hamburg a {
	color: var(--vp-c-text-2);
	text-decoration: none;
}

.made-in-hamburg a:hover {
	color: var(--vp-c-brand-1);
	text-decoration: underline;
}

.legal-links a {
	color: var(--vp-c-text-2);
	text-decoration: none;
}

.legal-links a:hover {
	color: var(--vp-c-brand-1);
	text-decoration: underline;
}
</style>

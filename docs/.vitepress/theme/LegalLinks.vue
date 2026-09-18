<!--
Links to the app's legal notice, privacy policy and booking rules under every
doc page.
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
	<nav v-if="theme.legal" class="legal-links" aria-label="Legal">
		<a :href="theme.legal.impressum" target="_self" lang="de">Impressum</a>
		<span aria-hidden="true">·</span>
		<a :href="theme.legal.privacy" target="_self" lang="de">Datenschutz</a>
		<span aria-hidden="true">·</span>
		<a :href="theme.legal.rules" target="_self" lang="de">Buchungsregeln</a>
	</nav>
</template>

<style scoped>
.legal-links {
	display: flex;
	justify-content: center;
	gap: 0.5rem;
	margin-top: 3rem;
	padding-top: 1rem;
	border-top: 1px solid var(--vp-c-divider);
	color: var(--vp-c-text-3);
	font-size: 0.8rem;
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

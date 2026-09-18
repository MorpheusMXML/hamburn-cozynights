<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps<{ code: string }>();

const { isDark } = useData();
const source = decodeURIComponent(props.code);
const svg = ref('');
const failed = ref(false);
// Mermaid sizes the boxes by measuring the labels in this element, i.e. with the
// same page styles the finished diagram gets (otherwise text can be clipped).
const sandbox = ref<HTMLElement>();

const fontFamily = 'Inter, ui-sans-serif, system-ui, sans-serif';

/** Mermaid's cScale0..11 colours (used by timelines), cycling through the given fills and labels. */
function scale(fills: string[], labels: string[]) {
	const vars: Record<string, string> = {};
	for (let i = 0; i < 12; i++) {
		vars[`cScale${i}`] = fills[i % fills.length];
		vars[`cScaleLabel${i}`] = labels[i % labels.length];
	}
	return vars;
}

const lightVariables = {
	darkMode: false,
	background: '#ffffff',
	fontFamily,
	primaryColor: '#fdf2f8',
	primaryTextColor: '#1f1b2b',
	primaryBorderColor: '#db2777',
	secondaryColor: '#f0fdfa',
	secondaryTextColor: '#134e4a',
	secondaryBorderColor: '#0d9488',
	tertiaryColor: '#fff7ed',
	tertiaryTextColor: '#7c2d12',
	tertiaryBorderColor: '#ea580c',
	lineColor: '#6b6780',
	textColor: '#1f1b2b',
	mainBkg: '#fdf2f8',
	nodeBorder: '#db2777',
	clusterBkg: '#faf8fc',
	clusterBorder: '#e4def0',
	titleColor: '#1f1b2b',
	edgeLabelBackground: '#ffffff',
	noteBkgColor: '#fff7ed',
	noteTextColor: '#7c2d12',
	noteBorderColor: '#ea580c',
	actorBkg: '#fdf2f8',
	actorBorder: '#db2777',
	actorTextColor: '#1f1b2b',
	actorLineColor: '#b9b3c9',
	signalColor: '#1f1b2b',
	signalTextColor: '#1f1b2b',
	labelBoxBkgColor: '#f0fdfa',
	labelBoxBorderColor: '#0d9488',
	labelTextColor: '#134e4a',
	loopTextColor: '#1f1b2b',
	activationBkgColor: '#f0fdfa',
	activationBorderColor: '#0d9488',
	sequenceNumberColor: '#ffffff',
	attributeBackgroundColorOdd: '#ffffff',
	attributeBackgroundColorEven: '#faf8fc',
	// Timeline sections cycle through pink, teal, orange.
	...scale(['#fce7f3', '#ccfbf1', '#ffedd5'], ['#831843', '#134e4a', '#7c2d12'])
};

const darkVariables = {
	darkMode: true,
	background: '#16141d',
	fontFamily,
	primaryColor: '#241f31',
	primaryTextColor: '#f4f1fb',
	primaryBorderColor: '#f472b6',
	secondaryColor: '#0f2a28',
	secondaryTextColor: '#ccfbf1',
	secondaryBorderColor: '#2dd4bf',
	tertiaryColor: '#2b1d10',
	tertiaryTextColor: '#ffedd5',
	tertiaryBorderColor: '#fb923c',
	lineColor: '#a19bb8',
	textColor: '#e7e5ee',
	mainBkg: '#241f31',
	nodeBorder: '#f472b6',
	clusterBkg: '#1b1824',
	clusterBorder: '#3a3450',
	titleColor: '#f4f1fb',
	edgeLabelBackground: '#16141d',
	noteBkgColor: '#2b1d10',
	noteTextColor: '#ffedd5',
	noteBorderColor: '#fb923c',
	actorBkg: '#241f31',
	actorBorder: '#f472b6',
	actorTextColor: '#f4f1fb',
	actorLineColor: '#5b5570',
	signalColor: '#e7e5ee',
	signalTextColor: '#e7e5ee',
	labelBoxBkgColor: '#0f2a28',
	labelBoxBorderColor: '#2dd4bf',
	labelTextColor: '#ccfbf1',
	loopTextColor: '#e7e5ee',
	activationBkgColor: '#0f2a28',
	activationBorderColor: '#2dd4bf',
	sequenceNumberColor: '#16141d',
	attributeBackgroundColorOdd: '#1b1824',
	attributeBackgroundColorEven: '#241f31',
	...scale(['#4a1d3a', '#113b37', '#43290f'], ['#fbcfe8', '#99f6e4', '#fed7aa'])
};

let renderCount = 0;

async function render() {
	const run = ++renderCount;
	try {
		const { default: mermaid } = await import('mermaid');
		// Mermaid measures label text while rendering; wait for the web font first.
		await document.fonts?.ready;
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
			theme: 'base',
			fontFamily,
			themeVariables: isDark.value ? darkVariables : lightVariables
		});
		const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
		const result = await mermaid.render(id, source, sandbox.value);
		// A theme switch while rendering: only the latest render wins.
		if (run === renderCount) {
			svg.value = result.svg;
			failed.value = false;
		}
	} catch (err) {
		console.error('[Mermaid] could not render diagram', err);
		if (run === renderCount) failed.value = true;
	}
}

onMounted(render);
watch(isDark, render);
</script>

<template>
	<div class="mermaid-diagram">
		<div v-if="svg" v-html="svg" />
		<pre v-else-if="failed"><code>{{ source }}</code></pre>
		<div v-else class="mermaid-loading" aria-hidden="true" />
		<div ref="sandbox" class="mermaid-sandbox" aria-hidden="true" />
	</div>
</template>

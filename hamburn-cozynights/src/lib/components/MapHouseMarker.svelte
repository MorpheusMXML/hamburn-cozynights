<!--
@component
A house pin on the camp map, drawn with SVG elements only.

The previous marker was HTML inside a `<foreignObject>`. WebKit (Safari and
every browser on iOS) positions and hit-tests such content relative to the page
instead of the SVG, so the pins piled up in a corner and could not be tapped.
Plain SVG renders and hit-tests the same in all engines.

Place it inside a `<g transform="translate(x y)">`: the pin is drawn around the
origin. The glow uses the gradients `#marker-glow-{available|full|empty}` that
Map.svelte defines once (CSS filters on SVG children are unreliable in WebKit).
-->
<svelte:options namespace="svg" />

<script lang="ts">
	import { MAP_WIDTH, MARKER_LABEL_GAP, MARKER_LABEL_HEIGHT } from '$lib/map-geometry';
	import { houseKindEntry } from '$lib/accommodation';
	import type { HouseMarkerStatus } from '$lib/occupancy';

	export let name: string;
	/** House, hut group, tent area…: a hut group carries its icon on the pin. */
	export let kind = '';
	/** No free spot here fits what the guest is looking for. */
	export let faded = false;
	export let status: HouseMarkerStatus | string = 'available';
	export let labelPosition: 'top' | 'bottom' = 'bottom';
	export let hovered = false;
	export let selected = false;
	export let dragging = false;
	/** Radius of the invisible hit circle, in map units. */
	export let hitRadius = 30;
	/** Where the pin sits (map units) and how much it is scaled: the label is
	 * shifted sideways so it never hangs over the edge of the map. */
	export let x = MAP_WIDTH / 2;
	export let scale = 1;

	const FONT_SIZE = 11;
	const LABEL_HEIGHT = MARKER_LABEL_HEIGHT;
	const LABEL_PADDING = 9;
	const LABEL_GAP = MARKER_LABEL_GAP;
	/** Distance the label keeps from the map's left and right edge (map units). */
	const EDGE_MARGIN = 4;

	// A plain house needs no glyph; the other kinds say what they are.
	$: kindIcon = kind && kind !== 'house' ? (houseKindEntry(kind)?.icon ?? '') : '';
	$: isOccupied = status === 'full';
	$: isEmpty = status === 'empty';
	$: glowId = isOccupied ? 'full' : isEmpty ? 'empty' : 'available';
	// Long names would cover half the map; the full name is the pin's aria-label
	// and the heading of the house page.
	const MAX_LABEL_LENGTH = 24;
	$: fullLabel = (name || '').toUpperCase();
	$: label =
		fullLabel.length > MAX_LABEL_LENGTH
			? `${fullLabel.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
			: fullLabel;

	// Until the text is measured in the browser, estimate its width so the
	// server-rendered label already has a background of about the right size.
	let measuredWidth = 0;
	$: estimatedWidth = label.length * (FONT_SIZE * 0.72 + 1);
	$: labelWidth = (measuredWidth || estimatedWidth) + LABEL_PADDING * 2;
	$: labelY = labelPosition === 'top' ? -(LABEL_GAP + LABEL_HEIGHT) : LABEL_GAP;
	$: labelX = labelLeft(x, scale, labelWidth);

	/** Centred under the pin, but inside the map (marker units, i.e. before `scale`). */
	function labelLeft(pinX: number, pinScale: number, width: number): number {
		const min = (EDGE_MARGIN - pinX) / pinScale;
		const max = (MAP_WIDTH - EDGE_MARGIN - pinX) / pinScale - width;
		if (max < min) return -width / 2; // wider than the map: nothing better than centred
		return Math.min(max, Math.max(min, -width / 2));
	}

	function measure(node: SVGTextElement, _text: string) {
		const update = () => {
			try {
				// The drawn width. WebKit leaves the CSS letter-spacing out of
				// getComputedTextLength(), so the text stuck out of its background.
				measuredWidth = node.getBBox().width;
			} catch {
				measuredWidth = 0;
			}
		};
		update();
		// Web fonts can arrive after the first measurement.
		if (typeof document !== 'undefined' && 'fonts' in document) {
			document.fonts.ready.then(update).catch(() => {});
		}
		return { update };
	}
</script>

<g
	class="marker"
	class:hovered={hovered || selected}
	class:dragging
	class:occupied={isOccupied}
	class:empty={isEmpty}
	class:faded
>
	<!-- The only hit target: big enough for a thumb, also where the label isn't. -->
	<circle class="hit" r={hitRadius} fill="transparent" pointer-events="all" />

	<circle class="glow" r="24" fill="url(#marker-glow-{glowId})" pointer-events="none" />
	<circle class="pulse" r="12" pointer-events="none" />
	<circle class="pin" r="9" pointer-events="none" />
	{#if kindIcon}
		<text
			class="kind"
			x="0"
			y="0"
			font-size="10"
			text-anchor="middle"
			dominant-baseline="central"
			pointer-events="none"
			aria-hidden="true">{kindIcon}</text
		>
	{/if}

	<g class="label" transform="translate(0 {labelY})" pointer-events="none">
		<rect x={labelX} y="0" width={labelWidth} height={LABEL_HEIGHT} rx="4" />
		<text
			x={labelX + labelWidth / 2}
			y={LABEL_HEIGHT / 2}
			font-size={FONT_SIZE}
			text-anchor="middle"
			dominant-baseline="central"
			use:measure={label}>{label}</text
		>
	</g>
</g>

<style>
	.marker {
		--pin: #2dd4bf;
	}
	.marker.occupied {
		--pin: #f87171;
	}
	.marker.empty {
		--pin: #666;
	}

	.hit {
		cursor: pointer;
	}

	.marker.faded {
		opacity: 0.3;
	}

	.glow {
		opacity: 0.6;
		transition: opacity 0.2s;
	}

	.pin {
		fill: var(--pin);
		stroke: #fff;
		stroke-width: 3;
		transition:
			transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275),
			fill 0.2s;
	}

	.pulse {
		fill: none;
		stroke: var(--pin);
		stroke-width: 3;
		opacity: 0;
	}

	.label rect {
		fill: rgba(10, 10, 10, 0.92);
		stroke: #333;
		stroke-width: 1;
		transition: stroke 0.2s;
	}
	.label text {
		fill: #aaa;
		font-weight: 900;
		letter-spacing: 1px;
		transition: fill 0.2s;
	}

	.marker.hovered .pin {
		transform: scale(1.5);
		fill: #fff;
		stroke: var(--pin);
	}
	.marker.hovered .glow {
		opacity: 1;
	}
	.marker.hovered .pulse {
		animation: marker-pulse 1s infinite;
	}
	.marker.hovered .label rect {
		fill: #000;
		stroke: #f472b6;
		stroke-width: 2;
	}
	.marker.hovered .label text {
		fill: #fff;
	}

	.marker.dragging .pin {
		transform: scale(1.7);
	}
	.marker.dragging .hit {
		cursor: grabbing;
	}

	@keyframes marker-pulse {
		0% {
			transform: scale(1);
			opacity: 0.8;
		}
		100% {
			transform: scale(3);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pin {
			transition: none;
		}
		.marker.hovered .pulse {
			animation: none;
		}
	}
</style>

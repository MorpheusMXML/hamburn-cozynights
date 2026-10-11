<!--
@component
Make your bed: the bedding half of the check before every booking
($lib/booking-check). The hostel's pillow, blanket and mattress lie bare on
a bed; the guest's three covers wait in their bag. A tap flies a cover onto
its piece, a drag puts it there by hand: the duvet cover only fits the
blanket and the pillowcase only the pillow, the sheet slips under anything.
Once the bed is made, "I'll pack them" calls `onpacked`.

Light on old phones: one inline SVG of plain shapes (no filters, patterns or
canvas), every animation moves only transform and opacity, and none of them
loops for long. Without the Web Animations API, or with reduced motion, a
cover lands at once. Keyboard and screen readers: the covers are buttons,
each places itself, and a live line says what is left.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import {
		COVERS,
		SLEEPING_BAG_NOTE,
		coversLeftText,
		dropResult,
		wrongDropHint,
		type Cover
	} from '$lib/booking-check';

	let {
		titleId = 'make-bed-title',
		onpacked
	}: {
		/** The heading's id, for the dialog's aria-labelledby. */
		titleId?: string;
		/** The bed is made and the guest promised to pack the covers. */
		onpacked: () => void;
	} = $props();

	type Piece = Cover['piece'];
	type Point = { x: number; y: number };

	/** The drawing's coordinate space (the SVG's viewBox): the bed, the floor and the Zzz above it. */
	const VIEW = { y: 18, w: 320, h: 150 };
	/**
	 * Where each piece lies in the drawing, topmost first: the pillow and the
	 * blanket lie on the mattress. `cx`/`cy` is where a cover lands.
	 */
	const PIECES: {
		piece: Piece;
		x: number;
		y: number;
		w: number;
		h: number;
		cx: number;
		cy: number;
	}[] = [
		{ piece: 'pillow', x: 26, y: 58, w: 86, h: 40, cx: 69, cy: 78 },
		{ piece: 'blanket', x: 110, y: 78, w: 190, h: 56, cx: 212, cy: 105 },
		{ piece: 'mattress', x: 18, y: 86, w: 284, h: 40, cx: 74, cy: 106 }
	];
	/** Fingers are wider than a mouse pointer: a drop this close still counts (viewBox units). */
	const SLACK = 10;
	/** A press that moves this far (px) is a drag, not a tap. */
	const DRAG_FROM = 6;
	/** A click this soon after a drag ended belongs to the drag. */
	const OWN_CLICK_MS = 500;
	const FLY_MS = 460;
	const SETTLE_MS = 200;
	const HOME_MS = 280;
	/** The flying cover's box (px), centred on its path. */
	const GHOST = { w: 48, h: 36 };

	// The bedding's look in the drawing: a mattress's ticking, the
	// duvet cover's starry sky (x, y, radius). Plain paths and circles.
	const TICKING = Array.from({ length: 29 }, (_, i) => `M${31 + i * 9} 95V118`).join('');
	const STARS: [number, number, number][] = [
		[146, 100, 1.6],
		[165, 115, 1.1],
		[189, 101, 1.3],
		[231, 100, 1.5],
		[250, 114, 1.1],
		[262, 103, 1],
		[138, 111, 1],
		[284, 113, 0.9]
	];
	const BLANKET =
		'M112 88Q112 80 120 80L288 80Q296 80 296 88L296 125Q283 131 269 126Q255 121 241 127Q227 133 213 127Q199 121 185 127Q171 133 157 127Q143 121 131 126L126 128L126 96Q121 92 113 92Z';

	let placed = $state<Record<Cover['id'], boolean>>({ sheet: false, duvet: false, case: false });
	/** Covers on their way (a flight or a drag): their bag spot shows them lifted. */
	let lifted = $state<Record<Cover['id'], boolean>>({ sheet: false, duvet: false, case: false });
	let left = $derived(COVERS.filter((cover) => !placed[cover.id]).length);
	let made = $derived(left === 0);
	let hint = $state('');
	let announce = $state('');

	interface Flight {
		key: number;
		cover: Cover;
		from: Point;
		to: Point;
		ms: number;
		/** Back into the bag (a drop next to the bed or on the wrong piece). */
		home: boolean;
	}
	let flights = $state<Flight[]>([]);
	let bursts = $state<{ key: number; cover: Cover }[]>([]);
	let nextKey = 0;

	let drag = $state<{ cover: Cover; at: Point; over: Piece | null; fits: boolean } | null>(null);
	let press: { pointer: number; x: number; y: number; cover: Cover } | null = null;
	let dragEndedAt = -Infinity;

	let root: HTMLDivElement;
	let bed: SVGSVGElement;
	const buttons: Partial<Record<Cover['id'], HTMLButtonElement>> = {};
	let pledge = $state<HTMLButtonElement>();

	function quiet(): boolean {
		return (
			typeof window === 'undefined' ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
			typeof Element.prototype.animate !== 'function'
		);
	}

	/** A point inside the component, from a point on the screen. */
	function local(x: number, y: number): Point {
		const own = root.getBoundingClientRect();
		return { x: x - own.left, y: y - own.top };
	}

	/** Where a cover lands on its piece, inside the component. */
	function landingOf(piece: Piece): Point {
		const box = bed.getBoundingClientRect();
		const spot = PIECES.find((p) => p.piece === piece)!;
		return local(
			box.left + (spot.cx / VIEW.w) * box.width,
			box.top + ((spot.cy - VIEW.y) / VIEW.h) * box.height
		);
	}

	function centreOf(el: Element): Point {
		const box = el.getBoundingClientRect();
		return local(box.left + box.width / 2, box.top + box.height / 2);
	}

	/** The piece under a point on the screen, or null next to the bed. */
	function pieceAt(x: number, y: number): Piece | null {
		const box = bed.getBoundingClientRect();
		if (!box.width || !box.height) return null;
		const vx = ((x - box.left) / box.width) * VIEW.w;
		const vy = VIEW.y + ((y - box.top) / box.height) * VIEW.h;
		const hit = PIECES.find(
			(p) =>
				vx >= p.x - SLACK && vx <= p.x + p.w + SLACK && vy >= p.y - SLACK && vy <= p.y + p.h + SLACK
		);
		return hit?.piece ?? null;
	}

	/** The cover is on its piece: count it, cheer, and move on. */
	function put(cover: Cover) {
		if (placed[cover.id]) return;
		placed[cover.id] = true;
		lifted[cover.id] = false;
		hint = '';
		announce = made
			? 'Bed made! Now pack a bed sheet, a duvet cover and a pillowcase.'
			: `${cover.name} on the ${cover.piece}. ${coversLeftText(left)}.`;
		if (!quiet()) {
			const key = nextKey++;
			bursts.push({ key, cover });
			setTimeout(() => (bursts = bursts.filter((b) => b.key !== key)), 700);
		}
		try {
			navigator.vibrate?.(12);
		} catch {
			/* no vibration on this device */
		}
		void moveFocus(cover);
	}

	/**
	 * Keeps the keyboard where it was going: from a placed cover to the next
	 * one, and to "I'll pack them" once the bed is made. A guest who is busy
	 * elsewhere in the dialog keeps their focus.
	 */
	async function moveFocus(from: Cover) {
		const active = document.activeElement;
		if (active && active !== document.body && active !== buttons[from.id]) return;
		await tick();
		if (made) {
			pledge?.focus();
			return;
		}
		const next = COVERS.find((cover) => !placed[cover.id] && !lifted[cover.id]);
		if (next) buttons[next.id]?.focus();
	}

	function fly(cover: Cover, from: Point, to: Point, ms: number, home = false) {
		lifted[cover.id] = true;
		flights.push({ key: nextKey++, cover, from, to, ms, home });
	}

	function landed(flight: Flight) {
		if (!flights.some((f) => f.key === flight.key)) return;
		flights = flights.filter((f) => f.key !== flight.key);
		if (flight.home) lifted[flight.cover.id] = false;
		else put(flight.cover);
	}

	/** Plays one flight on its ghost: an arc for a tap, straight for a settle or the way home. */
	function flightPath(node: HTMLElement, flight: Flight) {
		const at = ({ x, y }: Point, scale: number, turn: number) =>
			`translate(${x - GHOST.w / 2}px, ${y - GHOST.h / 2}px) scale(${scale}) rotate(${turn}deg)`;
		const { from, to } = flight;
		const arc = flight.ms >= FLY_MS;
		const top = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 48 };
		const frames: Keyframe[] = flight.home
			? [{ transform: at(from, 1.1, -6) }, { transform: at(to, 1, 0) }]
			: arc
				? [
						{ transform: at(from, 1, 0) },
						{ transform: at(top, 1.2, -12), offset: 0.5 },
						{ transform: at(to, 0.55, 6), opacity: 0.25 }
					]
				: [{ transform: at(from, 1.15, -8) }, { transform: at(to, 0.55, 4), opacity: 0.25 }];
		const animation = node.animate(frames, {
			duration: flight.ms,
			easing: 'cubic-bezier(0.33, 0, 0.25, 1)',
			fill: 'forwards'
		});
		animation.finished.then(
			() => landed(flight),
			() => landed(flight)
		);
		return { destroy: () => animation.cancel() };
	}

	/** A tap, Enter or Space: the cover flies onto its piece. */
	function tapCover(cover: Cover, event: MouseEvent) {
		if (performance.now() - dragEndedAt < OWN_CLICK_MS) return;
		if (placed[cover.id] || lifted[cover.id]) return;
		if (quiet()) {
			put(cover);
			return;
		}
		const icon = (event.currentTarget as HTMLElement).querySelector('.icon') ?? event.currentTarget;
		fly(cover, centreOf(icon as Element), landingOf(cover.piece), FLY_MS);
	}

	function pointerDown(cover: Cover, event: PointerEvent) {
		if (placed[cover.id] || lifted[cover.id]) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		press = { pointer: event.pointerId, x: event.clientX, y: event.clientY, cover };
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}

	function pointerMove(event: PointerEvent) {
		if (!press || event.pointerId !== press.pointer) return;
		if (!drag) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_FROM) return;
			lifted[press.cover.id] = true;
			hint = '';
		}
		const over = pieceAt(event.clientX, event.clientY);
		drag = {
			cover: press.cover,
			at: local(event.clientX, event.clientY),
			over,
			fits: dropResult(press.cover, over) === 'fits'
		};
	}

	/** Letting go: on the right piece it settles there, anywhere else it flies home. */
	function pointerUp(event: PointerEvent, cancelled = false) {
		if (!press || event.pointerId !== press.pointer) return;
		const ended = drag;
		const cover = press.cover;
		press = null;
		drag = null;
		if (!ended) return; // a tap: the click after it flies the cover
		dragEndedAt = performance.now();
		const result = cancelled ? 'off' : dropResult(cover, ended.over);
		const motion = !quiet();
		if (result === 'fits') {
			if (motion) fly(cover, ended.at, landingOf(cover.piece), SETTLE_MS);
			else put(cover);
			return;
		}
		hint =
			result === 'wrong' && ended.over
				? wrongDropHint(cover, ended.over)
				: cancelled
					? ''
					: 'Drop it on the bed — or just tap it.';
		const home = buttons[cover.id];
		if (motion && home) fly(cover, ended.at, centreOf(home), HOME_MS, true);
		else lifted[cover.id] = false;
	}
</script>

<div class="make-bed" class:made bind:this={root}>
	<h2 id={titleId} class="title">Make your bed <span aria-hidden="true">🛏️</span></h2>
	<p class="lead">
		The hostel provides the <strong>pillow</strong> and the <strong>blanket</strong>. The
		<strong>covers</strong> come from your bag: tap each one, or drag it onto the bed.
	</p>

	<div class="stage">
		<svg
			bind:this={bed}
			class="bed"
			viewBox="0 {VIEW.y} {VIEW.w} {VIEW.h}"
			aria-hidden="true"
			focusable="false"
		>
			<ellipse class="floor" cx="160" cy="160" rx="150" ry="5" />
			<rect class="frame" x="8" y="40" width="14" height="118" rx="5" />
			<rect class="frame" x="298" y="80" width="14" height="78" rx="5" />
			<rect class="rail" x="16" y="120" width="288" height="12" rx="3" />

			<g
				class="piece"
				class:target={drag?.over === 'mattress' && drag.fits}
				class:nope={drag?.over === 'mattress' && !drag.fits}
			>
				<rect class="bare" x="22" y="90" width="276" height="32" rx="10" />
				<path class="texture" d={TICKING} />
				<text class="label" x="74" y="110" text-anchor="middle">MATTRESS</text>
			</g>
			{#if placed.sheet}
				<g class="cover-layer sheet">
					<rect class="fabric" x="21" y="89" width="278" height="34" rx="11" />
					<path class="seam" d="M30 118Q160 123 290 118" />
					<path class="seam" d="M26 97q5-5 12-2M294 97q-5-5-12-2" />
					<text class="label" x="74" y="110" text-anchor="middle">BED SHEET</text>
				</g>
			{/if}

			<g
				class="piece"
				class:target={drag?.over === 'pillow' && drag.fits}
				class:nope={drag?.over === 'pillow' && !drag.fits}
			>
				<rect class="bare" x="28" y="62" width="82" height="32" rx="16" />
				<path class="texture" d="M38 71Q69 67 100 71" />
				<text class="label" x="69" y="82" text-anchor="middle">PILLOW</text>
			</g>
			{#if placed.case}
				<g class="cover-layer case">
					<rect class="fabric" x="27" y="61" width="84" height="34" rx="17" />
					<path class="seam" d="M99 63Q106 78 99 93" />
					<text class="label" x="64" y="82" text-anchor="middle">PILLOWCASE</text>
				</g>
			{/if}

			<g
				class="piece"
				class:target={drag?.over === 'blanket' && drag.fits}
				class:nope={drag?.over === 'blanket' && !drag.fits}
			>
				<path class="bare" d={BLANKET} />
				<path
					class="texture"
					d="M134 96H290M134 104H290M134 112H290M152 88V121M182 88V121M242 88V121M272 88V121"
				/>
				<text class="label" x="212" y="109" text-anchor="middle">BLANKET</text>
			</g>
			{#if placed.duvet}
				<g class="cover-layer duvet">
					<path class="fabric" d={BLANKET} />
					<path
						class="fold"
						d="M112 88Q112 80 120 80L288 80Q296 80 296 88L296 93L113 93Q112 91 112 88Z"
					/>
					{#each STARS as [cx, cy, r], i (i)}
						<circle class="star" {cx} {cy} {r} style="--i: {i}" />
					{/each}
					<path class="moon" d="M277 98a6 6 0 1 0 6 9.5a4.6 4.6 0 1 1-6-9.5Z" />
					<text class="label" x="208" y="111" text-anchor="middle">DUVET COVER</text>
				</g>
			{/if}

			{#if made}
				<g class="zzz">
					<text x="116" y="54" style="--i: 0">z</text>
					<text x="127" y="42" style="--i: 1">z</text>
					<text x="139" y="30" style="--i: 2">Z</text>
				</g>
			{/if}
		</svg>

		{#each bursts as burst (burst.key)}
			{@const spot = PIECES.find((p) => p.piece === burst.cover.piece)!}
			<span
				class="burst {burst.cover.id}"
				style="left: {(spot.cx / VIEW.w) * 100}%; top: {((spot.cy - VIEW.y) / VIEW.h) * 100}%"
				aria-hidden="true"
			>
				{#each [0, 1, 2, 3, 4, 5] as ray (ray)}<i style="--ray: {ray}"></i>{/each}
			</span>
		{/each}
	</div>

	{#if !made}
		<div class="bag" role="group" aria-label="Your bag">
			<p class="bag-title"><span aria-hidden="true">🎒</span> Your bag</p>
			<div class="covers">
				{#each COVERS as cover (cover.id)}
					<button
						type="button"
						class="cover {cover.id}"
						class:lifted={lifted[cover.id]}
						disabled={placed[cover.id]}
						bind:this={buttons[cover.id]}
						aria-label={placed[cover.id]
							? `${cover.name}: on the ${cover.piece}`
							: `Put the ${cover.name.toLowerCase()} on the ${cover.piece}`}
						onclick={(event) => tapCover(cover, event)}
						onpointerdown={(event) => pointerDown(cover, event)}
						onpointermove={pointerMove}
						onpointerup={(event) => pointerUp(event)}
						onpointercancel={(event) => pointerUp(event, true)}
						onlostpointercapture={(event) => pointerUp(event, true)}
						oncontextmenu={(event) => event.preventDefault()}
					>
						{@render icon(cover.id)}
						<!-- Every tag is two short words, so a narrow bag breaks it at the space:
						     a third of a 320 px phone is narrower than "Pillowcase" in wide fonts
						     (Linux CI), and the layout test counts any break inside a word. -->
						<span class="cover-name"
							>{#if placed[cover.id]}On the bed ✓{:else if cover.id === 'case'}Pillow case{:else}{cover.name}{/if}</span
						>
					</button>
				{/each}
			</div>
		</div>
		<p class="status" class:hint={!!hint} aria-hidden="true">{hint || coversLeftText(left)}</p>
	{:else}
		<div class="made-card" in:fade={{ duration: 220 }}>
			<p class="made-title"><span aria-hidden="true">✨</span> Bed made!</p>
			<p class="made-text">
				Now pack these three for real: <strong>bed sheet</strong>, <strong>duvet cover</strong> and
				<strong>pillowcase</strong>. Pillow and blanket are waiting for you.
			</p>
			<p class="made-note"><span aria-hidden="true">🛌</span> {SLEEPING_BAG_NOTE}</p>
			<button type="button" class="pledge" bind:this={pledge} onclick={() => onpacked()}>
				I'll pack them <span aria-hidden="true">🤝</span>
			</button>
		</div>
	{/if}

	{#each flights as flight (flight.key)}
		<span class="ghost" use:flightPath={flight} aria-hidden="true"
			>{@render icon(flight.cover.id)}</span
		>
	{/each}
	{#if drag}
		<span
			class="ghost held"
			class:fits={drag.fits}
			style="transform: translate({drag.at.x - GHOST.w / 2}px, {drag.at.y -
				GHOST.h / 2}px) scale(1.15) rotate(-8deg)"
			aria-hidden="true">{@render icon(drag.cover.id)}</span
		>
	{/if}

	<!-- Visually hidden on purpose: the layout test skips it. -->
	<p class="sr-only" aria-live="polite" data-layout-ignore>{announce}</p>
</div>

<!-- A folded cover as it lies in the bag (and while it flies). -->
{#snippet icon(id: Cover['id'])}
	<svg class="icon {id}" viewBox="0 0 48 36" aria-hidden="true" focusable="false">
		<rect class="cloth" x="5" y="15" width="38" height="15" rx="5" />
		<rect class="cloth upper" x="8" y="6" width="32" height="13" rx="5" />
		{#if id === 'sheet'}
			<path class="mark" d="M9 25q5 3 10 0t10 0t10 0" />
		{:else if id === 'duvet'}
			<circle class="dot" cx="16" cy="12" r="1.4" />
			<circle class="dot" cx="25" cy="10" r="1" />
			<circle class="dot" cx="32" cy="13.5" r="1.2" />
		{:else}
			<path class="mark" d="M33 8q4 4.5 0 9" />
		{/if}
	</svg>
{/snippet}

<style>
	.make-bed {
		--sheet: #2dd4bf;
		--duvet: #a855f7;
		--case: #f472b6;
		--star: #fde68a;
		position: relative;
		text-align: left;
	}

	.title {
		margin: 0 0 0.4rem;
		font-weight: 900;
		font-size: clamp(1.5rem, 7vw, 2rem);
		letter-spacing: -1px;
		line-height: 1.15;
		color: #fff;
	}

	.lead {
		margin: 0 0 1rem;
		color: #a3a3a3;
		font-weight: 500;
		line-height: 1.45;
	}
	.lead strong {
		color: #fff;
	}

	/* ── The bed ──────────────────────────────────────────────────── */
	.stage {
		position: relative;
		padding: 0.5rem 0.5rem 0.1rem;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.07);
		background:
			radial-gradient(80% 70% at 50% 100%, rgba(168, 85, 247, 0.16), transparent 70%), #0b0910;
		transition: border-color 0.4s;
	}
	.make-bed.made .stage {
		border-color: rgba(168, 85, 247, 0.55);
	}
	/* The glow when the bed is made: a ring that fades in and out once.
	   Only its opacity moves. */
	.stage::after {
		content: '';
		position: absolute;
		top: -1px;
		right: -1px;
		bottom: -1px;
		left: -1px;
		border-radius: inherit;
		box-shadow:
			0 0 0 1px rgba(168, 85, 247, 0.6),
			0 0 34px rgba(168, 85, 247, 0.35);
		opacity: 0;
		pointer-events: none;
	}
	.make-bed.made .stage::after {
		animation: made-glow 1.6s ease-out 2;
	}

	.bed {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.floor {
		fill: rgba(0, 0, 0, 0.45);
	}
	.frame {
		fill: #1b1426;
		stroke: rgba(168, 85, 247, 0.5);
		stroke-width: 1.5;
	}
	.rail {
		fill: #150f1e;
		stroke: rgba(168, 85, 247, 0.35);
		stroke-width: 1.2;
	}

	/* Bare bedding: grey, dashed — it waits for its cover. */
	.bare {
		fill: #211e27;
		stroke: #6b6575;
		stroke-width: 1.5;
		stroke-dasharray: 5 4;
		transition: stroke 0.15s;
	}
	.texture {
		fill: none;
		stroke: #302c38;
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	.label {
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 8.5px;
		font-weight: 800;
		letter-spacing: 1.4px;
		fill: #b8b2c2;
		/* a dark halo keeps the word readable over the texture */
		paint-order: stroke;
		stroke: #211e27;
		stroke-width: 3px;
		stroke-linejoin: round;
	}
	/* While a cover is dragged over a piece: a solid white edge when it fits
	   there, red when it doesn't. */
	.piece.target .bare {
		stroke: #fff;
		stroke-dasharray: none;
	}
	.piece.nope .bare {
		stroke: #fb7185;
		stroke-dasharray: none;
	}

	/* The covers: each comes on with a move of its own. */
	.cover-layer {
		transform-box: fill-box;
	}
	.cover-layer .label {
		font-size: 7.5px;
		letter-spacing: 1px;
	}
	.fabric {
		stroke-width: 2;
	}
	.seam,
	.fold {
		fill: none;
		stroke-width: 1.3;
		stroke-linecap: round;
	}

	.cover-layer.sheet {
		transform-origin: left center;
		animation: sheet-on 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
	}
	.sheet .fabric {
		fill: #0d2b29;
		stroke: var(--sheet);
	}
	.sheet .seam {
		stroke: rgba(45, 212, 191, 0.55);
	}
	.sheet .label {
		fill: #99f6e4;
		stroke: #0d2b29;
	}

	.cover-layer.case {
		transform-origin: center;
		animation: case-on 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
	}
	.case .fabric {
		fill: #3a1330;
		stroke: var(--case);
	}
	.case .seam {
		stroke: rgba(244, 114, 182, 0.7);
	}
	.case .label {
		fill: #fbcfe8;
		stroke: #3a1330;
	}

	.cover-layer.duvet {
		animation: duvet-on 0.55s cubic-bezier(0.25, 0.9, 0.35, 1.2) both;
	}
	.duvet .fabric {
		fill: #1c1036;
		stroke: var(--duvet);
	}
	.duvet .fold {
		fill: #2b1a52;
		stroke: rgba(168, 85, 247, 0.6);
	}
	.duvet .label {
		fill: #e9d5ff;
		stroke: #1c1036;
	}
	.star {
		fill: var(--star);
		transform-box: fill-box;
		transform-origin: center;
	}
	.moon {
		fill: var(--star);
	}
	.make-bed.made .star {
		animation: twinkle 0.9s ease-in-out calc(var(--i) * 0.12s) 3;
	}

	.zzz text {
		font-family: 'Inter', system-ui, sans-serif;
		font-weight: 900;
		font-size: 12px;
		fill: #c4b5fd;
		opacity: 0;
		animation: drift 2.2s ease-out calc(0.3s + var(--i) * 0.35s) 2;
	}

	/* A little star of rays where a cover landed. */
	.burst {
		position: absolute;
		width: 0;
		height: 0;
		pointer-events: none;
	}
	.burst i {
		position: absolute;
		left: -1px;
		top: -14px;
		width: 2px;
		height: 9px;
		border-radius: 2px;
		background: var(--tone);
		transform-origin: 1px 14px;
		transform: rotate(calc(var(--ray) * 60deg)) translateY(0) scaleY(0.4);
		opacity: 0;
		animation: ray 0.55s ease-out both;
	}
	.burst.sheet {
		--tone: var(--sheet);
	}
	.burst.duvet {
		--tone: var(--star);
	}
	.burst.case {
		--tone: var(--case);
	}

	/* ── The bag ──────────────────────────────────────────────────── */
	.bag {
		margin-top: 0.9rem;
		padding: 0.55rem 0.6rem 0.65rem;
		border-radius: 16px;
		border: 1px dashed rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.02);
	}
	.bag-title {
		margin: 0 0 0.45rem;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: #a3a3a3;
	}
	.covers {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.cover {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-width: 0;
		min-height: 78px;
		padding: 0.5rem 0.3rem;
		border-radius: 14px;
		border: 1.5px solid var(--tone);
		background: #0d0b12;
		color: #fff;
		font: inherit;
		cursor: grab;
		/* a drag must not scroll the dialog, select text or open a menu */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
		transition:
			transform 0.15s,
			opacity 0.2s,
			border-color 0.2s;
	}
	.cover.sheet {
		--tone: rgba(45, 212, 191, 0.75);
	}
	.cover.duvet {
		--tone: rgba(168, 85, 247, 0.8);
	}
	.cover.case {
		--tone: rgba(244, 114, 182, 0.8);
	}
	.cover:hover:not(:disabled) {
		transform: translateY(-2px);
	}
	.cover:active:not(:disabled) {
		cursor: grabbing;
	}
	.cover:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
	/* On its way to the bed: the bag keeps an empty spot. */
	.cover.lifted .icon {
		opacity: 0.15;
	}
	.cover:disabled {
		cursor: default;
		border-style: dashed;
		opacity: 0.55;
	}
	.cover:disabled .icon {
		opacity: 0.25;
	}
	.cover-name {
		font-size: 0.75rem;
		font-weight: 800;
		line-height: 1.2;
		text-align: center;
	}
	/* Small phones: the three covers keep one row, with a little less air. */
	@media (max-width: 380px) {
		.bag {
			padding: 0.5rem 0.45rem 0.55rem;
		}
		.covers {
			gap: 0.35rem;
		}
		.cover {
			padding: 0.45rem 0.2rem;
		}
	}

	.icon {
		display: block;
		width: 48px;
		height: 36px;
		transition: opacity 0.15s;
	}
	.icon .cloth {
		stroke-width: 1.6;
	}
	.icon .mark {
		fill: none;
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.icon.sheet .cloth {
		fill: #0d2b29;
		stroke: var(--sheet);
	}
	.icon.sheet .upper {
		fill: #12403c;
	}
	.icon.sheet .mark {
		stroke: rgba(45, 212, 191, 0.7);
	}
	.icon.duvet .cloth {
		fill: #1c1036;
		stroke: var(--duvet);
	}
	.icon.duvet .upper {
		fill: #2b1a52;
	}
	.icon.duvet .dot {
		fill: var(--star);
	}
	.icon.case .cloth {
		fill: #3a1330;
		stroke: var(--case);
	}
	.icon.case .upper {
		fill: #521b44;
	}
	.icon.case .mark {
		stroke: rgba(244, 114, 182, 0.8);
	}

	.status {
		margin: 0.55rem 0 0;
		min-height: 1.3em;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #8a8a8a;
		text-align: center;
	}
	.status.hint {
		color: #fda4af;
		text-transform: none;
		letter-spacing: 0;
	}

	/* The cover in the air. Absolute inside the component, moved by transform
	   only: no layout while it flies. */
	.ghost {
		position: absolute;
		left: 0;
		top: 0;
		width: 48px;
		height: 36px;
		pointer-events: none;
		z-index: 3;
		will-change: transform;
	}
	.ghost.held {
		opacity: 0.92;
	}
	.ghost.held.fits {
		opacity: 1;
	}

	/* ── Made ─────────────────────────────────────────────────────── */
	.made-card {
		margin-top: 0.9rem;
		padding: 0.9rem 1rem 1rem;
		border-radius: 16px;
		border: 1px solid rgba(168, 85, 247, 0.45);
		background: linear-gradient(180deg, rgba(168, 85, 247, 0.12), rgba(168, 85, 247, 0.03));
	}
	.made-title {
		margin: 0 0 0.35rem;
		font-weight: 900;
		font-size: 1.1rem;
		color: #f5d0fe;
	}
	.made-text,
	.made-note {
		margin: 0 0 0.6rem;
		color: #c4c4c4;
		font-size: 0.9rem;
		line-height: 1.45;
	}
	.made-text strong {
		color: #fff;
	}
	.made-note {
		color: #a3a3a3;
		font-size: 0.82rem;
	}
	.pledge {
		width: 100%;
		min-height: 48px;
		margin-top: 0.2rem;
		padding: 0.8rem 1rem;
		border: none;
		border-radius: 12px;
		background: linear-gradient(90deg, #a855f7, #f472b6);
		color: #0b0910;
		font-weight: 900;
		font-size: 0.95rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		cursor: pointer;
		transition: transform 0.15s;
	}
	.pledge:hover {
		transform: translateY(-2px);
	}
	.pledge:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}

	@keyframes sheet-on {
		from {
			transform: scaleX(0.06);
			opacity: 0.4;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes case-on {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		100% {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes duvet-on {
		from {
			transform: translateY(-22px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes twinkle {
		50% {
			transform: scale(1.9);
			opacity: 0.6;
		}
	}
	@keyframes drift {
		0% {
			opacity: 0;
			transform: translate(0, 6px);
		}
		30% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(8px, -10px);
		}
	}
	@keyframes ray {
		0% {
			opacity: 1;
			transform: rotate(calc(var(--ray) * 60deg)) translateY(0) scaleY(0.4);
		}
		100% {
			opacity: 0;
			transform: rotate(calc(var(--ray) * 60deg)) translateY(-12px) scaleY(1);
		}
	}
	@keyframes made-glow {
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cover-layer,
		.make-bed.made .star,
		.make-bed.made .stage::after,
		.zzz text {
			animation: none;
		}
		.zzz {
			display: none;
		}
		.cover,
		.cover:hover:not(:disabled),
		.pledge:hover {
			transform: none;
			transition: none;
		}
	}
</style>

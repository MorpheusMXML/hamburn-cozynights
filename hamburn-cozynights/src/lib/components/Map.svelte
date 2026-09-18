<script lang="ts">
	import MapHouseMarker from './MapHouseMarker.svelte';
	import { houseMarkerStatus } from '$lib/occupancy';
	import {
		MAP_WIDTH,
		MAP_HEIGHT,
		MAP_IMAGE,
		clampToMap,
		isTooCloseToOtherHouse,
		screenToMap
	} from '$lib/map-geometry';
	import { toast } from '$lib/dialogs';
	import { goto } from '$app/navigation';
	import { createEventDispatcher } from 'svelte';
	import type { BookingPhase } from '$lib/booking-phase';

	export let houses: any[] = [];
	export let isEditorMode = false;
	export let isBookingActive = false;
	/** Guests: houses can be opened in Live Booking and after booking closed (read-only). */
	export let phase: BookingPhase | null = null;
	/** Editor: the layout is locked (live or closed). Defaults to isBookingActive. */
	export let layoutLocked: boolean | null = null;

	$: browsable = phase ? phase !== 'staging' : isBookingActive;

	// Calculate label positions to avoid overlaps
	$: labelPositions = (houses || []).reduce(
		(acc, house) => {
			const isSomeoneBelow = houses.some(
				(other) =>
					other.id !== house.id &&
					Math.abs(other.x - house.x) < 50 &&
					other.y > house.y &&
					other.y - house.y < 60
			);
			acc[house.id] = isSomeoneBelow ? 'top' : 'bottom';
			return acc;
		},
		{} as Record<string, 'top' | 'bottom'>
	);

	// The layout can only be edited in the admin's editor during Staging.
	$: canEditLayout = isEditorMode && !(layoutLocked ?? isBookingActive);

	const dispatch = createEventDispatcher();

	// Mouse Glow State
	let mouseX = 0;
	let mouseY = 0;
	let svgEl: SVGSVGElement;

	// Screen pixels per map unit. On a phone the whole map is ~390px wide, so
	// pins and their touch targets are drawn larger there.
	let mapScale = 1;
	$: markerScale = Math.min(2.2, Math.max(1, 0.8 / mapScale));
	$: hitRadius = Math.min(64, Math.max(30, 24 / mapScale)) / markerScale;

	function trackScale(node: SVGSVGElement) {
		const measure = () => {
			const box = node.getBoundingClientRect();
			mapScale = Math.min(box.width / MAP_WIDTH, box.height / MAP_HEIGHT) || 1;
		};
		measure();
		if (typeof ResizeObserver === 'undefined') return {};
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	function toMapPoint(event: { clientX: number; clientY: number }) {
		const ctm = svgEl?.getScreenCTM();
		return ctm ? screenToMap(event.clientX, event.clientY, ctm) : null;
	}

	function handlePointerMoveGlobal(event: PointerEvent) {
		if (event.pointerType !== 'mouse') return;
		const point = toMapPoint(event);
		if (point) ({ x: mouseX, y: mouseY } = point);
	}

	// Drag & Drop. Pointer events cover mouse, touch and pen alike; the pointer
	// is captured by the pin, so the drag keeps going when the finger leaves it.
	const DRAG_THRESHOLD_PX = 5;
	type Gesture = {
		houseId: string;
		pointerId: number;
		startClientX: number;
		startClientY: number;
		startX: number;
		startY: number;
		offsetX: number;
		offsetY: number;
		dragging: boolean;
	};
	let gesture: Gesture | null = null;
	let suppressNextClick = false;
	let selectedHouseId: string | null = null;
	let hoveredHouseId: string | null = null;

	$: draggingHouseId = gesture?.dragging ? gesture.houseId : null;

	function setHousePosition(houseId: string, x: number, y: number) {
		const index = houses.findIndex((h) => h.id === houseId);
		if (index === -1) return;
		houses[index].x = x;
		houses[index].y = y;
		houses = [...houses];
	}

	function handlePointerDown(event: PointerEvent, house: any) {
		if (!isEditorMode) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const point = toMapPoint(event);
		if (!point) return;

		suppressNextClick = false;
		gesture = {
			houseId: house.id,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startX: house.x,
			startY: house.y,
			offsetX: point.x - house.x,
			offsetY: point.y - house.y,
			dragging: false
		};
		try {
			(event.currentTarget as Element).setPointerCapture(event.pointerId);
		} catch {
			// No capture (very old browser): the drag still works over the pin.
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.pointerId) return;

		if (!gesture.dragging) {
			const distance = Math.hypot(
				event.clientX - gesture.startClientX,
				event.clientY - gesture.startClientY
			);
			if (distance < DRAG_THRESHOLD_PX) return;
			if (!canEditLayout) {
				// Someone tries to move a house while the layout is locked: say so
				// instead of silently doing nothing.
				endGesture(event);
				suppressNextClick = true;
				dispatch('layoutLocked');
				return;
			}
			gesture.dragging = true;
			gesture = gesture;
		}

		event.preventDefault();
		const point = toMapPoint(event);
		if (!point) return;
		const next = clampToMap({ x: point.x - gesture.offsetX, y: point.y - gesture.offsetY });
		// Pins must not end up on top of each other.
		if (isTooCloseToOtherHouse(houses, gesture.houseId, next)) return;
		setHousePosition(gesture.houseId, next.x, next.y);
	}

	function endGesture(event: PointerEvent) {
		const target = event.currentTarget as Element | null;
		try {
			if (target?.hasPointerCapture?.(event.pointerId)) {
				target.releasePointerCapture(event.pointerId);
			}
		} catch {
			// already released
		}
		gesture = null;
	}

	function handlePointerUp(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		const finished = gesture;
		endGesture(event);

		// Whatever this gesture was, the browser's own click that may follow it
		// must not act a second time. (After a prevented touchstart there is none,
		// so the flag also clears itself.)
		suppressNextClick = true;
		setTimeout(() => (suppressNextClick = false), 400);

		const house = houses.find((h) => h.id === finished.houseId);
		if (!house) return;
		if (!finished.dragging) {
			openHouse(house);
		} else if (house.x !== finished.startX || house.y !== finished.startY) {
			dispatch('houseMoved', { id: house.id, x: house.x, y: house.y });
		}
	}

	/** A touch that starts on a movable pin drags the pin, it never scrolls the page. */
	function handleTouchStart(event: TouchEvent) {
		if (canEditLayout && event.cancelable) event.preventDefault();
	}

	function handlePointerCancel(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		const cancelled = gesture;
		endGesture(event);
		if (cancelled.dragging) setHousePosition(cancelled.houseId, cancelled.startX, cancelled.startY);
	}

	function openHouse(house: any) {
		if (isEditorMode) {
			if (selectedHouseId === house.id) {
				selectedHouseId = null;
			} else {
				selectedHouseId = house.id;
				dispatch('renameHouse', house);
			}
			return;
		}
		if (!browsable) {
			toast('Booking is not open yet. You can look around once Live Booking starts.', 'info');
			return;
		}
		goto(`/house/${house.id}`);
	}

	function handleHouseClick(event: MouseEvent, house: any) {
		event.preventDefault();
		event.stopPropagation();
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		openHouse(house);
	}

	const ARROW_STEPS: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};
	let nudgedHouseId: string | null = null;

	function handleHouseKeydown(event: KeyboardEvent, house: any) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openHouse(house);
			return;
		}
		// Arrow keys move the focused house (Shift: bigger steps); saved on key up.
		const step = ARROW_STEPS[event.key];
		if (!step || !isEditorMode) return;
		event.preventDefault();
		if (!canEditLayout) {
			dispatch('layoutLocked');
			return;
		}
		const size = event.shiftKey ? 10 : 1;
		const next = clampToMap({ x: house.x + step[0] * size, y: house.y + step[1] * size });
		if (isTooCloseToOtherHouse(houses, house.id, next)) return;
		setHousePosition(house.id, next.x, next.y);
		nudgedHouseId = house.id;
	}

	function handleHouseKeyup(event: KeyboardEvent, house: any) {
		if (!ARROW_STEPS[event.key] || nudgedHouseId !== house.id) return;
		nudgedHouseId = null;
		dispatch('houseMoved', { id: house.id, x: house.x, y: house.y });
	}

	function handleMapClick(event: MouseEvent) {
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		if (selectedHouseId) {
			selectedHouseId = null;
			return;
		}
		if (!isEditorMode) return;
		if (!canEditLayout) {
			dispatch('layoutLocked');
			return;
		}
		const point = toMapPoint(event);
		if (!point) return;
		dispatch('locationSelected', clampToMap(point));
	}

	function handleMapKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			selectedHouseId = null;
		}
	}
</script>

<div class="map-wrapper" on:pointermove={handlePointerMoveGlobal} role="presentation">
	<svg
		viewBox="0 0 {MAP_WIDTH} {MAP_HEIGHT}"
		preserveAspectRatio="xMidYMid meet"
		on:click={handleMapClick}
		on:keydown={handleMapKeydown}
		bind:this={svgEl}
		use:trackScale
		class:editor={isEditorMode}
		class:locked={isEditorMode && !canEditLayout}
		style="background: #0a0a0a;"
		role="presentation"
		aria-label="Interactive house map"
	>
		<defs>
			<radialGradient id="mouseGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
				<stop offset="0%" stop-color="rgba(45, 212, 191, 0.2)" />
				<stop offset="100%" stop-color="rgba(45, 212, 191, 0)" />
			</radialGradient>
			<!-- Pin glows by status (MapHouseMarker). Gradients instead of CSS
			     filters: those are unreliable on SVG children in WebKit. -->
			<radialGradient id="marker-glow-available">
				<stop offset="35%" stop-color="rgba(45, 212, 191, 0.75)" />
				<stop offset="100%" stop-color="rgba(45, 212, 191, 0)" />
			</radialGradient>
			<radialGradient id="marker-glow-full">
				<stop offset="35%" stop-color="rgba(248, 113, 113, 0.75)" />
				<stop offset="100%" stop-color="rgba(248, 113, 113, 0)" />
			</radialGradient>
			<radialGradient id="marker-glow-empty">
				<stop offset="35%" stop-color="rgba(102, 102, 102, 0.75)" />
				<stop offset="100%" stop-color="rgba(102, 102, 102, 0)" />
			</radialGradient>
		</defs>

		<image
			href={MAP_IMAGE}
			width={MAP_WIDTH}
			height={MAP_HEIGHT}
			class="map-image"
			class:blurred={!browsable && !isEditorMode}
		/>

		<!-- Dynamic Mouse Glow -->
		<circle
			cx={mouseX}
			cy={mouseY}
			r={isEditorMode ? 150 : 100}
			fill="url(#mouseGlow)"
			pointer-events="none"
			opacity={isEditorMode ? 1 : 0.5}
		/>

		{#if houses && houses.length > 0}
			<g class="marker-layer">
				{#each houses as house (house.id)}
					<g
						class="house-group"
						class:draggable={canEditLayout}
						transform="translate({house.x} {house.y})"
						on:pointerdown={(e) => handlePointerDown(e, house)}
						on:touchstart|nonpassive={handleTouchStart}
						on:pointermove={handlePointerMove}
						on:pointerup={handlePointerUp}
						on:pointercancel={handlePointerCancel}
						on:click={(e) => handleHouseClick(e, house)}
						on:keydown={(e) => handleHouseKeydown(e, house)}
						on:keyup={(e) => handleHouseKeyup(e, house)}
						on:pointerenter={(e) => {
							if (e.pointerType === 'mouse') hoveredHouseId = house.id;
						}}
						on:pointerleave={() => (hoveredHouseId = null)}
						role="button"
						tabindex="0"
						aria-label="House {house.name}"
					>
						<g transform="scale({markerScale})">
							<MapHouseMarker
								name={house.name}
								status={houseMarkerStatus(house)}
								labelPosition={labelPositions[house.id]}
								hovered={hoveredHouseId === house.id}
								selected={selectedHouseId === house.id}
								dragging={draggingHouseId === house.id}
								{hitRadius}
							/>
						</g>
					</g>
				{/each}
			</g>
		{/if}
	</svg>
</div>

<style>
	.map-wrapper {
		width: 100%;
		height: 100%;
		background: #000;
		position: relative;
		cursor: crosshair;
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	.map-image {
		transition: filter 1s ease;
	}
	.map-image.blurred {
		filter: blur(5px) grayscale(0.5) brightness(0.3);
	}

	.house-group {
		cursor: pointer;
		outline: none;
		-webkit-tap-highlight-color: transparent;
	}
	/* While the layout is editable a touch on a pin drags it instead of
	   scrolling the page. */
	.house-group.draggable,
	.house-group.draggable :global(.hit) {
		cursor: grab;
		touch-action: none;
	}
	.house-group:focus-visible :global(.pin) {
		stroke: #f472b6;
		stroke-width: 4;
	}
	svg.locked {
		cursor: not-allowed;
	}

	.marker-layer {
		animation: fadeIn 0.3s ease-out forwards;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>

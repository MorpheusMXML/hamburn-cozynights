<script lang="ts">
	import UserHouseMarker from './UserHouseMarker.svelte';
	import { createEventDispatcher, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	export let houses: any[] = [];
	export let isEditorMode = false;
	export let isBookingActive = false;

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

	$: console.log(`[Map] Houses: ${houses?.length}, Active: ${isBookingActive}`);

	const dispatch = createEventDispatcher();

	// Mouse Glow State
	let mouseX = 0;
	let mouseY = 0;
	let svgEl: SVGSVGElement;

	function handleMouseMoveGlobal(event: MouseEvent) {
		if (!svgEl) return;
		const CTM = svgEl.getScreenCTM();
		if (!CTM) return;
		mouseX = (event.clientX - CTM.e) / CTM.a;
		mouseY = (event.clientY - CTM.f) / CTM.d;
	}

	// Drag & Drop State
	let draggingHouseId: string | null = null;
	let dragOffset = { x: 0, y: 0 };
	let hasDragged = false;
	let selectedHouseId: string | null = null;
	let hoveredHouseId: string | null = null;

	function handleMouseDown(event: MouseEvent, house: any) {
		if (!isEditorMode || isBookingActive) return;
		draggingHouseId = house.id;
		hasDragged = false;
		const svg = (event.currentTarget as SVGElement).closest('svg');
		if (!svg || !svg.getScreenCTM()) return;
		const CTM = svg.getScreenCTM()!;
		const mX = (event.clientX - CTM.e) / CTM.a;
		const mY = (event.clientY - CTM.f) / CTM.d;
		dragOffset = { x: mX - house.x, y: mY - house.y };
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function handleMouseMove(event: MouseEvent) {
		if (!draggingHouseId || !svgEl || !svgEl.getScreenCTM()) return;
		hasDragged = true;
		const CTM = svgEl.getScreenCTM()!;
		const mX = (event.clientX - CTM.e) / CTM.a;
		const mY = (event.clientY - CTM.f) / CTM.d;
		const newX = Math.round(mX - dragOffset.x);
		const newY = Math.round(mY - dragOffset.y);

		// Check if new position is too close to any other house (min 25 units)
		const tooClose = houses.some(
			(h) =>
				h.id !== draggingHouseId &&
				Math.sqrt(Math.pow(h.x - newX, 2) + Math.pow(h.y - newY, 2)) < 25
		);
		if (tooClose) return;

		const index = houses.findIndex((h) => h.id === draggingHouseId);
		if (index !== -1) {
			houses[index].x = newX;
			houses[index].y = newY;
			houses = [...houses];
		}
	}

	function handleMouseUp() {
		if (draggingHouseId) {
			const house = houses.find((h) => h.id === draggingHouseId);
			if (house && hasDragged) {
				dispatch('houseMoved', { id: house.id, x: house.x, y: house.y });
			}
			draggingHouseId = null;
		}
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

	function handleHouseClick(event: MouseEvent, house: any) {
		event.preventDefault();
		event.stopPropagation();
		if (isEditorMode) {
			if (hasDragged) return;
			if (selectedHouseId === house.id) {
				selectedHouseId = null;
			} else {
				selectedHouseId = house.id;
				dispatch('renameHouse', house);
			}
			return;
		}
		if (!isBookingActive) {
			alert('PATIENCE, BURNER! 🏜️ Staging Mode calibration active.');
			return;
		}
		window.location.href = `/house/${house.id}`;
	}

	function handleHouseKeydown(event: KeyboardEvent, house: any) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			// Simulate click
			const mouseEvent = new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				view: window
			});
			handleHouseClick(mouseEvent, house);
		}
	}

	function handleMapClick(event: MouseEvent) {
		if (selectedHouseId) {
			selectedHouseId = null;
			return;
		}
		if (!isEditorMode) return;
		if (!svgEl || !svgEl.getScreenCTM()) return;
		const CTM = svgEl.getScreenCTM()!;
		const x = Math.round((event.clientX - CTM.e) / CTM.a);
		const y = Math.round((event.clientY - CTM.f) / CTM.d);
		dispatch('locationSelected', { x, y });
	}

	function handleMapKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			selectedHouseId = null;
		}
	}

	function handleMouseEnter(houseId: string) {
		hoveredHouseId = houseId;
	}

	function handleMouseLeave() {
		hoveredHouseId = null;
	}
</script>

<div class="map-wrapper" on:mousemove={handleMouseMoveGlobal} role="presentation">
	<svg
		viewBox="0 0 1000 700"
		preserveAspectRatio="xMidYMid meet"
		on:click={handleMapClick}
		on:keydown={handleMapKeydown}
		bind:this={svgEl}
		style="background: #0a0a0a;"
		role="presentation"
		aria-label="Interactive house map"
	>
		<defs>
			<radialGradient id="mouseGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
				<stop offset="0%" stop-color="rgba(45, 212, 191, 0.2)" />
				<stop offset="100%" stop-color="rgba(45, 212, 191, 0)" />
			</radialGradient>
		</defs>

		<image
			href="/lageplan-brahmsee.jpg"
			width="1000"
			height="700"
			class="map-image"
			class:blurred={!isBookingActive && !isEditorMode}
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
						class:selected={selectedHouseId === house.id}
						on:mousedown={(e) => handleMouseDown(e, house)}
						on:click={(e) => handleHouseClick(e, house)}
						on:keydown={(e) => handleHouseKeydown(e, house)}
						on:mouseenter={() => handleMouseEnter(house.id)}
						on:mouseleave={handleMouseLeave}
						role="button"
						tabindex="0"
						aria-label="House {house.name}"
					>
						<foreignObject x={house.x} y={house.y} width="1" height="1" style="overflow: visible;">
							<UserHouseMarker
								name={house.name}
								status={house.occupiedBeds >= house.totalBeds ? 'full' : 'available'}
								labelPosition={labelPositions[house.id]}
								hovered={hoveredHouseId === house.id}
							/>
						</foreignObject>
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
		cursor: grab;
		pointer-events: auto;
		outline: none;
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
